#!/usr/bin/env node
/**
 * Texas Science Phase D2b — dry-run orchestrator.
 *
 * Generates ONE scenario + 5 candidate cluster questions, judges each
 * question via the science judge (claude-sonnet-4-5), and prints the
 * full payload (scenario + questions + verdicts + provenance stamps)
 * as a dry-run preview. NO DDB writes in D2b.
 *
 * Mirror of scripts/reading/run-seed-batch.js orchestration shape:
 *   Stage 1: scenario gen (judge-scenario.js does NOT exist yet —
 *            scenario is accepted as-generated; flag as TODO for E)
 *   Stage 2: question set gen + per-question judge (concurrency 4),
 *            regen up to QUESTION_REGEN_BUDGET=3 attempts, hold if at
 *            least MIN_QUESTIONS_TO_KEEP=4 pass
 *   Stage 3 (--write only — UNREACHABLE in D2b): persist to DDB
 *   Stage 3' (--dry-run, default): print + write JSON to output/
 *
 * CLI flags:
 *   --dry-run                default; print payload, no DDB
 *   --write                  D2b: errors immediately ("not implemented")
 *   --brief-id <id>          run a single brief (D2b smoke uses g5-circuits-lab)
 *
 * Exit code: 0 on success (scenario generated AND ≥4 questions pass).
 *            1 on any failure (scenario gen error, <4 questions pass,
 *            judge budget exceeded, etc.).
 *
 * Run:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
 *       --secret-id staar-tutor/anthropic-api-key \
 *       --region us-east-1 --query SecretString --output text) \
 *     node scripts/science/run-seed-batch.js --brief-id g5-circuits-lab
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { generateScenario } = require('./generate-scenario');
const { generateQuestionSet } = require('./generate-question');
const { judgeQuestion } = require('./judge-question');
const { judgeScenario } = require('./judge-scenario');
const { verifyQuestion } = require('./verifier');
const { loadKP } = require('./lib/load-kp');

const STATE = 'texas';
const SCENARIO_REGEN_BUDGET = 3;
const QUESTION_REGEN_BUDGET = 3;
const QUESTIONS_PER_SCENARIO = 5;
const MIN_QUESTIONS_TO_KEEP = 4;
const SCENARIO_CONCURRENCY = 3;
const JUDGE_CONCURRENCY = 4;
const VERIFIER_CONCURRENCY = 4;

const OUTPUT_DIR = path.resolve(__dirname, 'output');

// ---- AWS SDK lazy-require (only when --write) ----
// Borrows from scripts/cold-start/node_modules via NODE_PATH; avoids a
// new package.json per the locked decisions.
let _ddbClient = null;
let _PutCommand = null;
let _DocClient = null;
let _ConditionalCheckFailedException = null;
function getDdb() {
  if (_ddbClient) return { ddb: _ddbClient, PutCommand: _PutCommand };
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const lib = require('@aws-sdk/lib-dynamodb');
  _DocClient = lib.DynamoDBDocumentClient;
  _PutCommand = lib.PutCommand;
  _ddbClient = _DocClient.from(new DynamoDBClient({ region: 'us-east-1' }));
  return { ddb: _ddbClient, PutCommand: _PutCommand };
}

const PASSAGES_TABLE = 'staar-passages';
const POOL_TABLE = 'staar-content-pool';

// ---- Phase H briefs — 20 Grade 5, each maps to ONE content SE ----
//
// Locked redesign per Phase H spec:
// - Each brief points at exactly ONE Grade-5 CONTENT SE (no Practices SEs,
//   no cross-grade temptation).
// - Topic phrased so the most natural question tests THAT SE — includes
//   an explicit "asks them to relate/compare/identify..." hook.
// - Banned phrasing that bait Practices SEs:
//     "table", "graph", "data table", "variable", "repeat the experiment",
//     "communicate findings", "use a tool", "Setup 1/2/3" (visual labels).
// - Distribution: 5/5/5/5 across 4 content strands.
// - 6 region tags (gulf_coast, hill_country, piney_woods, dfw, big_bend,
//   panhandle) spread across strands.
// - scenarioType mix: 8 experiment, 6 data_analysis, 6 described_diagram.
const BRIEFS = [
  // ----- Matter & Energy (5) -----
  // 5.6A — compare/contrast matter by physical properties (Readiness)
  { id: 'g5-density-sink-float', grade: 5, scenarioType: 'experiment',
    topic: 'students drop wooden, plastic, metal, and stone objects into a container of water and observe which sink and which float; the question asks them to relate floating or sinking to relative density compared with water',
    regionTag: null, targetTeks: '5.6A' },
  // 5.6A — magnetism + thermal conductivity (still 5.6A — physical properties)
  { id: 'g5-magnet-iron-vs-plastic', grade: 5, scenarioType: 'described_diagram',
    topic: 'a description of a kitchen drawer containing an iron nail, a copper penny, a plastic button, and a wooden spoon; the question asks the student to identify which property of matter explains why only the iron nail is attracted to a magnet',
    regionTag: null, targetTeks: '5.6A' },
  // 5.6B — mixtures retain physical properties (Supporting)
  { id: 'g5-mixture-rice-beans', grade: 5, scenarioType: 'experiment',
    topic: 'students pour a cup of rice and a cup of dried beans together in a bowl and stir; the question asks whether the rice and beans kept their original shape, color, and size after being mixed',
    regionTag: null, targetTeks: '5.6B' },
  // 5.6B — mixture properties (sand + iron filings) — emphasis on properties retained
  { id: 'g5-mixture-iron-sand-properties', grade: 5, scenarioType: 'described_diagram',
    topic: 'a description of iron filings mixed with dry sand in a clear cup; the question asks the student to identify which physical property of iron tells them iron filings did not change when mixed with sand',
    regionTag: null, targetTeks: '5.6B' },
  // 5.6C — solution conservation (Supporting)
  { id: 'g5-solution-mass-conserved', grade: 5, scenarioType: 'experiment',
    topic: 'students place a cup of water on a balance, read the mass, stir in a spoonful of sugar until it dissolves, and read the mass again; the question asks whether the total mass changed and what that tells them about matter when something dissolves',
    regionTag: 'piney_woods', targetTeks: '5.6C' },

  // ----- Force, Motion & Energy (5) -----
  // 5.7A — equal vs unequal forces causing motion (Supporting)
  { id: 'g5-tug-of-war-forces', grade: 5, scenarioType: 'experiment',
    topic: 'students play tug-of-war, first with two equal teams of three on each side and the rope does not move, then with three students against one and the rope moves; the question asks the student to explain why the rope moves only in the second case',
    regionTag: null, targetTeks: '5.7A' },
  // 5.7A — pushing a box on the floor (still 5.7A — equal/unequal forces)
  { id: 'g5-box-push-friction', grade: 5, scenarioType: 'described_diagram',
    topic: 'a description of one student pushing a heavy box across a classroom floor and the box not moving, then two students pushing together and the box sliding; the question asks the student to identify the relationship between the force applied and whether the box moves',
    regionTag: null, targetTeks: '5.7A' },
  // 5.7B — design a simple force investigation (Supporting)
  { id: 'g5-toy-car-ramp-investigation', grade: 5, scenarioType: 'experiment',
    topic: 'students roll a toy car down a wooden ramp set at three different heights and measure how far the car travels each time; the question asks the student to identify which factor was changed on purpose to test how force affects the car',
    regionTag: null, targetTeks: '5.7B' },
  // 5.8B — circuit requirements (Readiness)
  { id: 'g5-circuit-broken-wire', grade: 5, scenarioType: 'described_diagram',
    topic: 'a description of a battery connected to a small bulb with two wires; in one connection both wires touch the metal of the battery and the bulb lights, in another connection one wire touches only the plastic side of the battery and the bulb does not light; the question asks the student to identify what is required for an electrical circuit to power the bulb',
    regionTag: 'gulf_coast', targetTeks: '5.8B' },
  // 5.8C — light travels in straight line and can be reflected (Readiness)
  { id: 'g5-light-flashlight-mirror', grade: 5, scenarioType: 'described_diagram',
    topic: 'a description of a flashlight pointed at a flat mirror in a darkened room with the beam bouncing off the mirror onto a far wall; the question asks the student to identify what the light beam does when it hits the mirror surface',
    regionTag: null, targetTeks: '5.8C' },

  // ----- Earth & Space (5) -----
  // 5.9A — Earth rotation causes day/night and Sun's apparent motion (Readiness)
  { id: 'g5-shadow-morning-afternoon', grade: 5, scenarioType: 'data_analysis',
    topic: 'a class observes the shadow of a flagpole and finds it points west in the morning and east in the afternoon; the question asks the student to identify what causes the shadow to change direction during the day',
    regionTag: null, targetTeks: '5.9A' },
  // 5.10A — Sun-water cycle interaction (Supporting)
  { id: 'g5-puddle-evaporation-sun', grade: 5, scenarioType: 'data_analysis',
    topic: 'a student observes a small rain puddle on a sunny morning and finds the puddle is gone by afternoon; the question asks the student to identify the role of the Sun in what happened to the water',
    regionTag: null, targetTeks: '5.10A' },
  // 5.10B — sedimentary rock formation (Readiness)
  { id: 'g5-sediment-layers-ocean', grade: 5, scenarioType: 'described_diagram',
    topic: 'a description of layers of sand, mud, and small shells slowly settling on the floor of a calm sea over thousands of years and eventually being pressed together into solid rock; the question asks the student to identify the type of rock that forms from this process',
    regionTag: 'gulf_coast', targetTeks: '5.10B' },
  // 5.10B — fossil fuel formation (still 5.10B — sedimentary processes)
  { id: 'g5-fossil-fuel-ancient-plants', grade: 5, scenarioType: 'described_diagram',
    topic: 'a description of dead plants and tiny ocean creatures sinking to the bottom of an ancient swamp millions of years ago, getting buried under more layers, and slowly turning into coal and oil; the question asks the student to identify the process that formed these fossil fuels',
    regionTag: 'big_bend', targetTeks: '5.10B' },
  // 5.10C — wind/water/ice form landforms (Readiness)
  { id: 'g5-canyon-water-erosion', grade: 5, scenarioType: 'experiment',
    topic: 'students pour a cup of water down a hillside model made of sand and watch the water carve a small channel through the sand; the question asks the student to identify which natural process creates canyons and similar landforms over a long time',
    regionTag: 'panhandle', targetTeks: '5.10C' },

  // ----- Organisms & Environments (5) -----
  // 5.12A — organisms surviving via biotic + abiotic interactions (Readiness)
  { id: 'g5-pond-frogs-temperature', grade: 5, scenarioType: 'experiment',
    topic: 'students observe that a pond has many active frogs in spring and summer but few in winter; the question asks the student to identify what living factor and what nonliving factor most affect frog activity through the year',
    regionTag: null, targetTeks: '5.12A' },
  // 5.12A — Hill Country bats + insects (still 5.12A — population interactions)
  { id: 'g5-bats-insects-hill-country', grade: 5, scenarioType: 'experiment',
    topic: 'a Hill Country class learns that thousands of Mexican free-tailed bats fly out at dusk to eat moths and mosquitoes; the question asks the student to predict what would happen to the local insect population if the bat colony disappeared',
    regionTag: 'hill_country', targetTeks: '5.12A' },
  // 5.12A — DFW prairie ecosystem
  { id: 'g5-prairie-grasshopper-rain', grade: 5, scenarioType: 'experiment',
    topic: 'students learn that grasshoppers in a North Texas prairie eat grass that grows when there is enough rain; the question asks the student to identify what would most likely happen to the grasshopper population during a long drought',
    regionTag: 'dfw', targetTeks: '5.12A' },
  // 5.13A — structure-function adaptation (Readiness)
  { id: 'g5-bird-beak-shape-food', grade: 5, scenarioType: 'experiment',
    topic: 'students examine drawings of a hummingbird with a long thin beak that drinks flower nectar, a hawk with a sharp curved beak that tears meat, and a duck with a wide flat bill that filters water; the question asks the student to identify how each beak shape helps the bird get its specific food',
    regionTag: null, targetTeks: '5.13A' },
  // 5.13A — desert plant adaptations (still 5.13A — structure-function)
  { id: 'g5-cactus-leaves-water', grade: 5, scenarioType: 'described_diagram',
    topic: 'a description of a prickly pear cactus that has thick fleshy stems and tiny spines instead of broad leaves, growing in a hot, dry West Texas desert where rain is rare; the question asks the student to identify how the cactus structure helps it survive in that environment',
    regionTag: 'big_bend', targetTeks: '5.13A' },

  // ============================================================
  // Grade 3 briefs (TEKS §112.5) — practice-only, K-8 STAAR not
  // tested at this grade, but kids on gradeearn at Grade 3 should
  // see real Grade-3 TEKS-aligned content.
  // Distribution: 5 per strand; grade-appropriate vocabulary
  // (~age 8-9); NO Practices SE bait language.
  // ============================================================

  // ----- Matter & Energy (5) -----
  // 3.6A — physical properties (sink/float)
  { id: 'g3-rock-vs-cork-sink-float', grade: 3, scenarioType: 'experiment',
    topic: 'a class drops a small rock and a cork stopper into a clear bowl of water; the rock sinks and the cork floats; the question asks the student to identify the physical property they observed in the rock and the cork',
    regionTag: null, targetTeks: '3.6A' },
  // 3.6A — physical properties (magnetism in mixed objects)
  { id: 'g3-magnet-picks-which-objects', grade: 3, scenarioType: 'described_diagram',
    topic: 'a description of a tray holding a steel paperclip, a wooden block, an aluminum can tab, and an iron nail; a student moves a strong magnet over the tray and finds the paperclip and the iron nail stick to the magnet but the wooden block and the aluminum can tab do not; the question asks the student to identify which physical property the magnet was testing',
    regionTag: null, targetTeks: '3.6A' },
  // 3.6B — solids vs liquids (shape vs container)
  { id: 'g3-juice-poured-into-cup', grade: 3, scenarioType: 'described_diagram',
    topic: 'a description of a wooden block and a cup of apple juice sitting on a table, then the juice being poured into a tall narrow glass while the wooden block is moved next to the glass; the question asks the student to identify what happens to the shape of each material when its container changes',
    regionTag: null, targetTeks: '3.6B' },
  // 3.6C — state changes from heating/cooling
  { id: 'g3-ice-cube-on-counter', grade: 3, scenarioType: 'experiment',
    topic: 'a student places an ice cube on a plate at room temperature and checks it every ten minutes; after thirty minutes there is no ice cube, only a small puddle of water; the question asks the student to identify what caused the ice to change',
    regionTag: null, targetTeks: '3.6C' },
  // 3.6D — combine materials based on properties
  { id: 'g3-build-rain-cover', grade: 3, scenarioType: 'described_diagram',
    topic: 'a Houston student wants to build a small cover that keeps a paper book dry on a rainy day; the choices in the supply box are a sheet of paper, a sheet of plastic, a piece of cotton cloth, and a piece of cardboard; the question asks the student to identify which material is best to use and why, based on its physical properties',
    regionTag: 'gulf_coast', targetTeks: '3.6D' },

  // ----- Force, Motion & Energy (5) -----
  // 3.7A — forces (magnetism)
  { id: 'g3-paperclip-pulled-by-magnet', grade: 3, scenarioType: 'experiment',
    topic: 'a student holds a magnet just above a steel paperclip lying on a desk; without touching the paperclip, the paperclip jumps up and sticks to the magnet; the question asks the student to identify the type of force that pulled the paperclip',
    regionTag: null, targetTeks: '3.7A' },
  // 3.7A — gravity (ball rolls down ramp)
  { id: 'g3-ball-rolls-down-ramp', grade: 3, scenarioType: 'experiment',
    topic: 'a student props one end of a wooden board on a stack of books to make a ramp and places a small ball at the top of the ramp; when the student lets go, the ball rolls down the ramp without anyone pushing it; the question asks the student to identify the force that caused the ball to roll down',
    regionTag: null, targetTeks: '3.7A' },
  // 3.7B — push/pull change in position
  { id: 'g3-push-pull-toy-truck', grade: 3, scenarioType: 'experiment',
    topic: 'a student has a toy truck on a tabletop and the truck is not moving; the student pushes it with one finger and the truck slides forward; the question asks the student to identify what changed the position of the toy truck',
    regionTag: null, targetTeks: '3.7B' },
  // 3.8A — energy examples (sound)
  { id: 'g3-clapping-hands-sound', grade: 3, scenarioType: 'described_diagram',
    topic: 'a description of a student clapping their hands together loudly in a quiet classroom; everyone in the room hears the clap, even with their eyes closed; the question asks the student to identify which type of energy carried the clap to their ears',
    regionTag: null, targetTeks: '3.8A' },
  // 3.8B — speed related to mechanical energy
  { id: 'g3-fast-vs-slow-marble', grade: 3, scenarioType: 'experiment',
    topic: 'a student rolls a marble slowly across a smooth tabletop, then rolls a second marble of the same size much faster across the same table; the fast marble bumps a small block at the end and pushes it farther than the slow marble does; the question asks the student to identify what is different about the energy of the fast marble compared to the slow marble',
    regionTag: null, targetTeks: '3.8B' },

  // ----- Earth & Space (5) -----
  // 3.9A — Sun, Earth, Moon system
  { id: 'g3-moon-around-earth', grade: 3, scenarioType: 'described_diagram',
    topic: 'a description of three balls used to model the solar system: a yellow ball labeled Sun in the middle, a blue ball labeled Earth that goes around the Sun, and a small gray ball labeled Moon that goes around Earth as Earth goes around the Sun; the question asks the student to identify what the Moon orbits',
    regionTag: null, targetTeks: '3.9A' },
  // 3.9B — order of planets
  { id: 'g3-planets-in-order', grade: 3, scenarioType: 'described_diagram',
    topic: 'a description of a poster showing the eight planets in our solar system in the correct order from the Sun, with names listed but no images: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune; the question asks the student to identify which planet is third from the Sun',
    regionTag: null, targetTeks: '3.9B' },
  // 3.10A — day-to-day weather
  { id: 'g3-windsock-weather', grade: 3, scenarioType: 'data_analysis',
    topic: 'a student watches a windsock outside the school each morning and writes down what she observes; on Monday the windsock points east, on Tuesday it points east, on Wednesday it points east; the question asks the student to identify what this tells her about the wind that week',
    regionTag: 'panhandle', targetTeks: '3.10A' },
  // 3.10B — soil formation by weathering
  { id: 'g3-cracked-rock-tiny-pieces', grade: 3, scenarioType: 'described_diagram',
    topic: 'a description of a large rock at the edge of a creek that has been there for many years; over time the rock has cracked, and small bits of sand and tiny pebbles have collected around its base; the question asks the student to identify what process turned parts of the rock into the small pieces around it',
    regionTag: 'hill_country', targetTeks: '3.10B' },
  // 3.10C — rapid Earth-surface changes (landslide / volcano)
  { id: 'g3-volcano-changes-land', grade: 3, scenarioType: 'described_diagram',
    topic: 'a description of a hillside that was covered in green trees and grass; then a volcano nearby erupts and covers the hillside in hot ash and lava in just a few hours; the question asks the student to identify what kind of change to Earth\'s surface the eruption caused',
    regionTag: null, targetTeks: '3.10C' },

  // ----- Organisms & Environments (5) -----
  // 3.12A — temperature/precipitation effects on animals
  { id: 'g3-bears-winter-sleep', grade: 3, scenarioType: 'described_diagram',
    topic: 'a description of a black bear that eats berries and fish all summer and fall; when winter comes and it gets very cold and food is hard to find, the bear curls up inside a den and stays asleep until spring; the question asks the student to identify what causes the bear to sleep through winter',
    regionTag: null, targetTeks: '3.12A' },
  // 3.12B — food chain energy flow
  { id: 'g3-grass-rabbit-fox', grade: 3, scenarioType: 'described_diagram',
    topic: 'a description of a simple food chain in a Texas field: grass grows in the field, rabbits eat the grass, and foxes eat the rabbits; the question asks the student to predict what would most likely happen to the foxes if a long drought killed almost all of the grass in the field',
    regionTag: 'dfw', targetTeks: '3.12B' },
  // 3.12D — fossils as evidence of past life
  { id: 'g3-texas-fossil-shell', grade: 3, scenarioType: 'described_diagram',
    topic: 'a description of a hiker in Central Texas who finds a small spiral-shaped shell pressed into a piece of limestone on a dry hillside; the hillside is far from any ocean today; the question asks the student to identify what the fossil shell tells us about that area long ago',
    regionTag: 'hill_country', targetTeks: '3.12D' },
  // 3.13A — external structures help survival
  { id: 'g3-duck-webbed-feet', grade: 3, scenarioType: 'described_diagram',
    topic: 'a description of a duck swimming on a pond using its wide webbed feet to push water behind it like paddles; on land the duck waddles slowly, but in the water it moves quickly; the question asks the student to identify how the duck\'s webbed feet help it survive',
    regionTag: 'piney_woods', targetTeks: '3.13A' },
  // 3.13B — life cycle (radish/beetle/butterfly)
  { id: 'g3-radish-life-cycle', grade: 3, scenarioType: 'experiment',
    topic: 'a student plants a radish seed in a cup of soil and waters it; after a few days a small green sprout appears, then leaves grow, then a small flower forms, and finally the plant makes new seeds; the question asks the student to identify what the very first stage of the radish life cycle is',
    regionTag: null, targetTeks: '3.13B' }
];

// ---- CLI ----
function parseArgs(argv) {
  const opts = { dryRun: true, write: false, briefId: null, grade: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--write') opts.write = true;
    else if (a === '--brief-id') opts.briefId = argv[++i];
    else if (a === '--grade') opts.grade = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: run-seed-batch.js [--dry-run] [--write] [--brief-id <id>] [--grade <n>]');
      process.exit(0);
    }
  }
  return opts;
}

// ---- Concurrency helper ----
async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array(Math.min(concurrency, items.length || 1)).fill(0).map(async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      try { results[myIdx] = await fn(items[myIdx], myIdx); }
      catch (err) { results[myIdx] = { __error: err && err.message || String(err) }; }
    }
  });
  await Promise.all(workers);
  return results;
}

function nowIso() { return new Date().toISOString(); }

function ensureOutputDir() { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); }

// ---- Pool key composer (per architecture-decisions.md schema lock) ----
function poolKeyFor(grade, scenarioId) {
  return scenarioId
    ? `${STATE}#${grade}#science#${scenarioId}`
    : `${STATE}#${grade}#science#standalone`;
}

// ---- Process a single brief (D2b is one) ----
async function processBrief(brief, opts, apiKey) {
  const tag = `[brief ${brief.id} g${brief.grade} ${brief.scenarioType}]`;

  // ---- Stage 1: scenario generation + judge ----
  // Regen up to SCENARIO_REGEN_BUDGET=3 attempts. On each rejection,
  // log the reason codes; if all 3 fail, give up on this brief.
  console.log(`${tag} Stage 1: generating scenario...`);
  let scenario = null;
  let scenarioVerdict = null;
  const scenarioRejects = [];
  for (let attempt = 1; attempt <= SCENARIO_REGEN_BUDGET; attempt++) {
    let candidate;
    try {
      candidate = await generateScenario({
        grade: brief.grade,
        topic: brief.topic,
        scenarioType: brief.scenarioType,
        regionTag: brief.regionTag,
        apiKey
      });
    } catch (err) {
      console.warn(`${tag} attempt ${attempt} SCENARIO-GEN-FAIL: ${(err.message || '').slice(0, 200)}`);
      scenarioRejects.push({ attempt, error: err.message });
      continue;
    }
    const verdict = await judgeScenario(candidate);
    if (verdict.verdict === 'pass') {
      scenario = candidate;
      scenarioVerdict = verdict;
      const wc = (candidate.body.match(/\S+/g) || []).length;
      console.log(`${tag} [scenario-judge] pass conf=${verdict.confidence} source=${verdict.source} (attempt ${attempt}, words=${wc})`);
      break;
    }
    const prefix = verdict.source === 'llm-error' ? '[scenario-judge:fail-open]' : '[scenario-judge]';
    const reasons = Array.isArray(verdict.reasons) ? verdict.reasons.join(', ') : '';
    console.log(`${tag} ${prefix} reject attempt ${attempt}: reasons=[${reasons}] note="${(verdict.note || '').slice(0, 120)}"`);
    scenarioRejects.push({ attempt, title: candidate.title, verdict });
  }

  if (!scenario) {
    return { ok: false, brief, reason: 'scenario-rejected-3x', scenarioRejects };
  }
  const wordCount = (scenario.body.match(/\S+/g) || []).length;
  console.log(`${tag} scenario OK: scenarioId=${scenario.scenarioId} title="${scenario.title}" words=${wordCount}`);

  // ---- Stage 2: question set gen + per-question judge ----
  let savedQuestions = [];
  const questionRejects = [];

  for (let attempt = 1; attempt <= QUESTION_REGEN_BUDGET; attempt++) {
    console.log(`${tag} Stage 2 attempt ${attempt}: generating ${QUESTIONS_PER_SCENARIO} questions...`);
    let questionSet;
    try {
      questionSet = await generateQuestionSet({
        scenario,
        grade: brief.grade,
        count: QUESTIONS_PER_SCENARIO,
        targetTeks: brief.targetTeks,
        apiKey
      });
    } catch (err) {
      console.error(`${tag} Q-GEN-FAIL attempt ${attempt}: ${(err.message || '').slice(0, 200)}`);
      continue;
    }

    // Build the canonical "judge-shape" item once per candidate so both
    // verifier and judge see the same fields.
    function judgeItemFor(q) {
      return {
        type: 'multiple_choice',
        subj: 'science',
        grade: brief.grade,
        tek_code: q.claimedTeks,
        claimedTeks: q.claimedTeks,
        strand: q.strand,
        standard_type: q.standardType,
        region_tag: q.regionTag,
        prompt: q.stem,
        choices: q.choices,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        passage: scenario ? { title: scenario.title, body: scenario.body } : undefined
      };
    }

    // Phase H — VERIFIER STAGE. Runs first; only verifier-passers go
    // to the judge. Two AI gates in fresh Anthropic contexts beats one
    // model checking its own work in the same prompt thread. Fail-open
    // on Anthropic error so verifier latency never blocks the sweep.
    console.log(`${tag} attempt ${attempt}: verifying ${questionSet.length} questions (concurrency=${VERIFIER_CONCURRENCY})...`);
    const verifications = await mapConcurrent(questionSet, VERIFIER_CONCURRENCY, async (q) => {
      return verifyQuestion(judgeItemFor(q));
    });

    // Partition: verifier-pass survives to judge; verifier-reject is
    // logged + recorded (does NOT call the judge).
    const survivors = [];
    const survivorIdx = [];
    for (let i = 0; i < questionSet.length; i++) {
      const ver = verifications[i];
      const candidate = questionSet[i];
      if (ver && !ver.__error && ver.verdict === 'pass') {
        const prefix = ver.source === 'llm-error' ? '[verifier:fail-open]' : '[verifier]';
        console.log(`${tag} ${prefix} q${i + 1}: pass conf=${ver.confidence} ans=${ver.verifierAnswer ?? '?'} agree=${ver.verifierAgreesWithGenerator ?? '?'} tek=${ver.tekAlignment} sci=${ver.scienceAccurate ?? '?'}`);
        survivors.push(candidate);
        survivorIdx.push(i);
      } else {
        const reasons = (ver && Array.isArray(ver.reasons)) ? ver.reasons.join(', ') : '(none)';
        const stemPreview = (candidate.stem || '').slice(0, 80);
        console.log(`${tag} [verifier] q${i + 1}: reject reasons=[${reasons}] genIdx=${candidate.correctIndex} verifierIdx=${ver?.verifierAnswer ?? '?'} stem="${stemPreview}"`);
        questionRejects.push({
          attempt, qIdx: i,
          stem: candidate.stem,
          claimedTeks: candidate.claimedTeks,
          tekText: candidate.tekText || null,
          strand: candidate.strand,
          standardType: candidate.standardType,
          choices: candidate.choices,
          correctIndex: candidate.correctIndex,
          explanation: candidate.explanation,
          regionTag: candidate.regionTag || null,
          rationale: candidate.rationale || null,
          rejectedBy: 'verifier',
          verifier: ver,
          verdict: { verdict: 'reject', reasons: ver?.reasons || [], source: ver?.source || 'unknown', confidence: ver?.confidence }
        });
      }
    }

    if (survivors.length === 0) {
      console.log(`${tag} attempt ${attempt}: 0/${questionSet.length} survived verifier — regen`);
      continue; // skip judge entirely; cheaper to regen
    }

    console.log(`${tag} attempt ${attempt}: judging ${survivors.length} verifier-survivors (concurrency=${JUDGE_CONCURRENCY})...`);
    const verdicts = await mapConcurrent(survivors, JUDGE_CONCURRENCY, async (q) => {
      return judgeQuestion(judgeItemFor(q));
    });

    const passing = [];
    for (let s = 0; s < survivors.length; s++) {
      const v = verdicts[s];
      const candidate = survivors[s];
      const i = survivorIdx[s];                // original index in questionSet
      const ver = verifications[i];
      if (v && !v.__error && v.verdict === 'pass') {
        const prefix = '[judge]';
        console.log(`${tag} ${prefix} q${i + 1}: pass conf=${v.confidence} source=${v.source}`);
        passing.push({ q: candidate, v, ver });
      } else {
        // Verifier passed, judge rejected — log the disagreement explicitly.
        // Don't override either: question must pass BOTH gates.
        const prefix = v && v.source === 'llm-error' ? '[judge:fail-open]' : '[verifier-judge-disagreement]';
        const reasons = v && Array.isArray(v.reasons) ? v.reasons.join(', ') : '(none)';
        const stemPreview = (candidate.stem || '').slice(0, 80);
        console.log(`${tag} ${prefix} q${i + 1}: judge=${v?.verdict || '(error)'} reasons=[${reasons}] (verifier-passed) stem="${stemPreview}"`);
        questionRejects.push({
          attempt, qIdx: i,
          stem: candidate.stem,
          claimedTeks: candidate.claimedTeks,
          tekText: candidate.tekText || null,
          strand: candidate.strand,
          standardType: candidate.standardType,
          choices: candidate.choices,
          correctIndex: candidate.correctIndex,
          explanation: candidate.explanation,
          regionTag: candidate.regionTag || null,
          rationale: candidate.rationale || null,
          rejectedBy: 'judge',
          verifier: ver,
          verdict: v
        });
      }
    }

    console.log(`${tag} attempt ${attempt}: ${passing.length}/${questionSet.length} passed`);
    if (passing.length >= MIN_QUESTIONS_TO_KEEP) {
      savedQuestions = passing.slice(0, QUESTIONS_PER_SCENARIO);
      break;
    }
  }

  if (savedQuestions.length < MIN_QUESTIONS_TO_KEEP) {
    return {
      ok: false,
      brief,
      scenario,
      reason: 'questions-below-min',
      savedCount: savedQuestions.length,
      questionRejects
    };
  }

  // ---- Stage 3: persist OR dry-run print ----
  // Provenance stamps applied to the in-memory payload here so the
  // write path (Phase E) lifts this object verbatim. Each question
  // row gets _judgedAt + _judgeVersion + verdict echo + _kpVersion.
  const judgedAt = nowIso();
  // Phase tag derives from --write (write path) vs default (dry-run).
  // BUG-fixed in Phase F: parseArgs defaults dryRun=true and --write
  // doesn't flip it, so the original `opts.dryRun ? ... : ...` ternary
  // tagged real-write rows as 'd2b-dry'. Now keys on opts.write.
  const phase = opts.write ? 'phase-e' : 'd2b-dry';
  const kpVersion = loadKP().version;

  const passageRow = {
    passageId: scenario.scenarioId,
    stateGradeGenre: `${STATE}_${brief.grade}_science_scenario`,
    state: STATE,
    grade: String(brief.grade),
    genre: 'science_scenario',
    scenarioType: scenario.scenarioType,
    regionTag: scenario.regionTag,
    title: scenario.title,
    body: scenario.body,
    wordCount,
    _generatedAt: scenario._generatedAt,
    _generatedBy: scenario._generatedBy,
    _judgedAt: judgedAt,
    _judgeVerdict: scenarioVerdict.verdict,
    _judgeConfidence: scenarioVerdict.confidence,
    _judgeReasons: scenarioVerdict.reasons || [],
    _judgeVersion: scenarioVerdict.judgeVersion,
    _kpVersion: kpVersion,
    _phase: phase
  };

  // Deterministic contentId per question — sha256(scenarioId+stem)
  // truncated to 12 chars. Re-runs of the same content are no-ops via
  // the ConditionExpression on PutCommand, NOT silent overwrites.
  function contentIdFor(scenarioId, stem) {
    const h = crypto.createHash('sha256').update(`${scenarioId}|${stem}`).digest('hex').slice(0, 12);
    return `q_${h}`;
  }

  const questionRows = savedQuestions.map((entry, i) => {
    const { q, v, ver } = entry;
    return {
      poolKey: poolKeyFor(brief.grade, scenario.scenarioId),
      contentId: contentIdFor(scenario.scenarioId, q.stem),
      type: 'science_mc',
      subject: 'science',
      state: STATE,
      grade: String(brief.grade),
      scenarioId: scenario.scenarioId,
      stem: q.stem,
      stemPattern: q.stemPattern,
      choices: q.choices,
      correctIndex: q.correctIndex,
      claimedTeks: q.claimedTeks,
      teks: q.claimedTeks,        // post-judge verified TEK = claimed (judge validated)
      strand: q.strand,
      standardType: q.standardType,
      regionTag: q.regionTag,
      explanation: q.explanation,
      status: 'active',
      generatedAt: Date.now(),    // Number, required for status-generatedAt-index GSI
      generatedAtIso: q._generatedAt,
      generatedBy: q._generatedBy,
      _judgedAt: judgedAt,
      _judgeVersion: v.judgeVersion,
      _judgeVerdict: v.verdict,
      _judgeConfidence: v.confidence,
      _judgeReasons: v.reasons,
      // Phase H — verifier provenance. Question passed BOTH the verifier
      // and the judge, but we record the verifier's verdict so future
      // audits can spot verifier↔judge agreement patterns.
      _verifiedAt: judgedAt,
      _verifierVersion: ver?.verifierVersion || null,
      _verifierVerdict: ver?.verdict || null,
      _verifierConfidence: ver?.confidence ?? null,
      _verifierAgreed: ver?.verifierAgreesWithGenerator ?? null,
      _verifierTekAlignment: ver?.tekAlignment || null,
      _verifierScienceAccurate: ver?.scienceAccurate ?? null,
      _kpVersion: kpVersion,
      _phase: phase
    };
  });

  // Stage 3 — real write (--write) OR dry-run print (default)
  if (opts.write) {
    const { ddb, PutCommand } = getDdb();
    const writeStats = { passageWritten: false, passageSkippedDup: false, questionsWritten: 0, questionsSkippedDup: 0 };
    // Passage row first. attribute_not_exists(passageId) makes re-runs
    // of the same brief idempotent (deterministic scenarioId).
    try {
      await ddb.send(new PutCommand({
        TableName: PASSAGES_TABLE,
        Item: passageRow,
        ConditionExpression: 'attribute_not_exists(passageId)'
      }));
      writeStats.passageWritten = true;
      console.log(`${tag} [write] staar-passages: ${scenario.scenarioId} (NEW)`);
    } catch (err) {
      if (err && err.name === 'ConditionalCheckFailedException') {
        writeStats.passageSkippedDup = true;
        console.log(`[skip-dup] passageId=${scenario.scenarioId}`);
      } else {
        throw err; // any other DDB error aborts the brief
      }
    }
    // Then each question. Same idempotency contract.
    for (const row of questionRows) {
      try {
        await ddb.send(new PutCommand({
          TableName: POOL_TABLE,
          Item: row,
          ConditionExpression: 'attribute_not_exists(contentId)'
        }));
        writeStats.questionsWritten++;
        console.log(`${tag} [write] staar-content-pool: ${row.contentId} (NEW)`);
      } catch (err) {
        if (err && err.name === 'ConditionalCheckFailedException') {
          writeStats.questionsSkippedDup++;
          console.log(`[skip-dup] contentId=${row.contentId}`);
        } else {
          throw err;
        }
      }
    }
    return { ok: true, brief, scenario, scenarioVerdict, passageRow, questionRows, questionRejects, writeStats };
  }

  // Stage 3' — dry-run print
  console.log('');
  console.log(`[DRY-RUN] would write to staar-passages:`);
  console.log(JSON.stringify(passageRow, null, 2));
  console.log('');
  for (let i = 0; i < questionRows.length; i++) {
    console.log(`[DRY-RUN] would write to staar-content-pool (q${i + 1}/${questionRows.length}):`);
    console.log(JSON.stringify(questionRows[i], null, 2));
    console.log('');
  }

  return { ok: true, brief, scenario, scenarioVerdict, passageRow, questionRows, questionRejects };
}

// ---- Main ----
async function main() {
  const opts = parseArgs(process.argv);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('FATAL: ANTHROPIC_API_KEY env var not set.');
    console.error('See top-of-file run command for the Secrets Manager fetch.');
    process.exit(1);
  }

  // E.1: --write may target ALL briefs (full pilot) OR --brief-id <id>
  // (single-brief retry). Either is valid.

  let briefs = BRIEFS.slice();
  if (opts.briefId) briefs = briefs.filter(b => b.id === opts.briefId);
  if (opts.grade != null) briefs = briefs.filter(b => b.grade === opts.grade);

  if (briefs.length === 0) {
    console.error(`No briefs matched --brief-id=${opts.briefId || '(unset)'} --grade=${opts.grade ?? '(unset)'}.`);
    console.error(`Available: ${BRIEFS.map(b => `${b.id}(g${b.grade})`).join(', ')}`);
    process.exit(1);
  }

  ensureOutputDir();
  const startedAt = nowIso();
  const startedMs = Date.now();
  const runId = startedAt.replace(/[:.]/g, '-');
  console.log(`[run-seed-batch] start runId=${runId} mode=${opts.write ? 'write' : 'dry-run'} briefs=${briefs.length}`);
  console.log('');

  // Outer concurrency = SCENARIO_CONCURRENCY but D2b runs at most 1 brief
  const results = await mapConcurrent(briefs, SCENARIO_CONCURRENCY, async (brief) => {
    return processBrief(brief, opts, apiKey);
  });

  const wallSec = Math.round((Date.now() - startedMs) / 1000);
  const passed = results.filter(r => r && r.ok);
  const failed = results.filter(r => r && !r.ok);

  // Write the run payload (full) to output/. Filename varies by mode.
  const outName = opts.write ? `pilot-${runId}.json` : `dry-run-${runId}.json`;
  const outPath = path.join(OUTPUT_DIR, outName);
  fs.writeFileSync(outPath, JSON.stringify({
    runId,
    startedAt,
    endedAt: nowIso(),
    wallClockSec: wallSec,
    mode: opts.write ? 'write' : 'dry-run',
    briefs,
    results
  }, null, 2));

  // Aggregate persisted-row counts (--write only)
  let totalQuestionsWritten = 0;
  let totalQuestionsSkippedDup = 0;
  let totalPassagesWritten = 0;
  let totalPassagesSkippedDup = 0;
  for (const r of passed) {
    if (r.writeStats) {
      totalQuestionsWritten += r.writeStats.questionsWritten || 0;
      totalQuestionsSkippedDup += r.writeStats.questionsSkippedDup || 0;
      if (r.writeStats.passageWritten) totalPassagesWritten++;
      if (r.writeStats.passageSkippedDup) totalPassagesSkippedDup++;
    }
  }

  // Sample-10 review file — only for --write runs with persisted rows
  let samplePath = null;
  if (opts.write && passed.length > 0) {
    samplePath = path.join(OUTPUT_DIR, 'pilot-sample-10.md');
    try {
      writeSample10(samplePath, passed);
      console.log(`Sample-10 review: ${samplePath}`);
    } catch (err) {
      console.warn(`[sample-10] failed to write: ${err.message}`);
    }
  }

  console.log('');
  console.log('=== RUN SUMMARY ===');
  console.log(`runId:                 ${runId}`);
  console.log(`mode:                  ${opts.write ? 'write' : 'dry-run'}`);
  console.log(`wallClockSec:          ${wallSec}`);
  console.log(`briefsAttempted:       ${briefs.length}`);
  console.log(`briefsPassed:          ${passed.length}`);
  console.log(`briefsFailed:          ${failed.length}`);
  if (opts.write) {
    console.log(`passagesWritten:       ${totalPassagesWritten}`);
    console.log(`passagesSkippedDup:    ${totalPassagesSkippedDup}`);
    console.log(`questionsWritten:      ${totalQuestionsWritten}`);
    console.log(`questionsSkippedDup:   ${totalQuestionsSkippedDup}`);
  }
  for (const r of failed) {
    console.log(`  FAILED ${r.brief?.id || '(no brief)'}: ${r.reason || r.__error || 'unknown'}`);
  }
  console.log(`Run payload:           ${outPath}`);

  process.exit(passed.length === briefs.length ? 0 : 1);
}

// Stratified sample-10 picker. Spec:
//   - 1 from each of the 4 Grade 5 strands (4 picks)
//   - 3 from STAAR Readiness standards (3 different teks)
//   - 2 with regionTag set
//   - 1 with the lowest _judgeConfidence (closest call)
// Picks de-dup by contentId so the same row isn't repeated.
function writeSample10(outPath, passedResults) {
  const allRows = [];
  for (const r of passedResults) {
    if (!Array.isArray(r.questionRows)) continue;
    for (const q of r.questionRows) {
      allRows.push({ q, scenario: r.scenario });
    }
  }
  if (allRows.length === 0) {
    fs.writeFileSync(outPath, '# Sample-10 review\n\n_(no questions persisted)_\n');
    return;
  }

  const picked = new Map();   // contentId → { q, scenario, why }
  function pick(row, why) {
    if (!row) return;
    if (picked.has(row.q.contentId)) return;
    picked.set(row.q.contentId, { ...row, why });
  }

  const STRANDS_G5 = [
    'Matter & Energy',
    'Force, Motion & Energy',
    'Earth & Space',
    'Organisms & Environments'
  ];
  // 1 from each strand
  for (const strand of STRANDS_G5) {
    const cand = allRows.find(r => r.q.strand === strand && !picked.has(r.q.contentId));
    if (cand) pick(cand, `strand: ${strand}`);
  }
  // 3 from Readiness, distinct teks (skip teks already in the picked set)
  const readinessTargets = ['5.6A', '5.8B', '5.9A', '5.10B', '5.10C', '5.12A', '5.13A'];
  let readinessPicked = 0;
  const seenTeks = new Set(Array.from(picked.values()).map(p => p.q.claimedTeks));
  for (const tek of readinessTargets) {
    if (readinessPicked >= 3) break;
    if (seenTeks.has(tek)) continue;
    const cand = allRows.find(r =>
      r.q.claimedTeks === tek &&
      r.q.standardType === 'Readiness' &&
      !picked.has(r.q.contentId)
    );
    if (cand) {
      pick(cand, `readiness: ${tek}`);
      seenTeks.add(tek);
      readinessPicked++;
    }
  }
  // 2 with regionTag set
  const regionRows = allRows.filter(r => r.q.regionTag && !picked.has(r.q.contentId));
  for (let i = 0; i < Math.min(2, regionRows.length); i++) {
    pick(regionRows[i], `regionTag: ${regionRows[i].q.regionTag}`);
  }
  // 1 with lowest _judgeConfidence
  const remaining = allRows.filter(r => !picked.has(r.q.contentId));
  if (remaining.length > 0) {
    remaining.sort((a, b) => (a.q._judgeConfidence || 0) - (b.q._judgeConfidence || 0));
    pick(remaining[0], `lowest-confidence: ${remaining[0].q._judgeConfidence}`);
  }

  // Backfill if we landed under 10 (small batches won't hit every bucket)
  if (picked.size < 10) {
    for (const r of allRows) {
      if (picked.size >= 10) break;
      if (!picked.has(r.q.contentId)) pick(r, 'backfill');
    }
  }

  const lines = [];
  lines.push(`# Pilot sample-10 review`);
  lines.push('');
  lines.push(`Sampled ${picked.size} questions from ${allRows.length} persisted across ${passedResults.length} scenarios.`);
  lines.push('');
  let i = 0;
  for (const entry of picked.values()) {
    i++;
    const q = entry.q;
    const sc = entry.scenario;
    const letters = ['A', 'B', 'C', 'D'];
    const correctLetter = letters[q.correctIndex] || '?';
    lines.push(`## Question ${i} — ${q.claimedTeks} — ${q.strand}`);
    lines.push(`*pick reason: ${entry.why}*`);
    lines.push('');
    lines.push(`**Stem:** ${q.stem}`);
    lines.push('');
    lines.push(`**Choices:**`);
    for (let j = 0; j < q.choices.length; j++) {
      lines.push(`  - ${letters[j]}. ${q.choices[j]}`);
    }
    lines.push('');
    lines.push(`**Correct:** ${correctLetter}`);
    lines.push('');
    lines.push(`**Explanation:** ${q.explanation || '(none)'}`);
    lines.push('');
    lines.push(`**Region:** ${q.regionTag || 'none'}`);
    lines.push('');
    lines.push(`**Judge:** ${q._judgeVerdict} (confidence ${q._judgeConfidence}) reasons=[${(q._judgeReasons || []).join(', ')}]`);
    lines.push('');
    if (sc && sc.body) {
      const truncated = sc.body.length > 200 ? sc.body.slice(0, 200) + '…' : sc.body;
      lines.push(`**Scenario context (truncated):** ${truncated}`);
      lines.push('');
    }
    lines.push(`---`);
    lines.push('');
  }
  fs.writeFileSync(outPath, lines.join('\n'));
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
