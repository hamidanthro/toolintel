#!/usr/bin/env node
/**
 * Texas Grade 3 reading seed batch — OpenAI-only pipeline.
 *
 * Single-file fork of the Claude-based scripts/reading/* pipeline.
 * Uses gpt-4o for both passage generation and question generation.
 * No separate judge stage in v1 — OpenAI generates + we light-validate
 * locally + save. Lower quality bar than the cross-vendor pipeline,
 * acceptable while Anthropic billing is being topped up.
 *
 * Usage:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     OPENAI_API_KEY=$(aws secretsmanager get-secret-value \
 *       --secret-id staar-tutor/openai-api-key \
 *       --region us-east-1 --query SecretString --output text) \
 *     node scripts/reading/run-seed-openai.js [--brief-id <id>] [--write]
 *
 * Default: dry-run (prints generated content + would-save target,
 * does NOT touch DDB). Pass --write to actually persist.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { loadKP } = require('./lib/load-kp');
const { getReadabilityReport } = require('./lib/readability');

const STATE = 'texas';
const MODEL = 'gpt-4o';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 90000;

const PASSAGES_TABLE = 'staar-passages';
const POOL_TABLE = 'staar-content-pool';
const OUTPUT_DIR = path.resolve(__dirname, 'output');

// Per-grade band targets used in the system prompt + post-validation.
// Real STAAR informational passages routinely score 1-2 grades above
// the kid's grade level on FK; that's normal. Bands are warnings, not
// blockers (the script logs and proceeds).
const GRADE_BANDS = {
  // K-2 are practice-only (STAAR doesn't test reading until grade 3).
  // Targets are calibrated for OpenAI text-only output, which lands
  // 1-2 FK grades higher than real classroom-K text (real K is
  // picture-supported; we have no pictures). Word counts match a
  // typical early-reader page set.
  'k': { fk: [0.5, 3.0], words: { 'realistic-fiction': [50, 160], informational: [60, 180] } },
  '1': { fk: [1.0, 3.5], words: { 'realistic-fiction': [80, 200], informational: [90, 220] } },
  '2': { fk: [1.5, 4.0], words: { 'realistic-fiction': [120, 280], informational: [140, 300] } },
  '3': { fk: [2.8, 5.0], words: { 'realistic-fiction': [200, 380], informational: [260, 450] } },
  '4': { fk: [3.5, 6.0], words: { 'realistic-fiction': [260, 460], informational: [320, 520] } },
  '5': { fk: [4.5, 7.0], words: { 'realistic-fiction': [320, 540], informational: [380, 600] } },
  '6': { fk: [5.5, 8.0], words: { 'realistic-fiction': [380, 620], informational: [440, 680] } },
  '7': { fk: [6.5, 9.0], words: { 'realistic-fiction': [440, 700], informational: [500, 760] } },
  '8': { fk: [7.5, 10.0], words: { 'realistic-fiction': [500, 780], informational: [560, 840] } }
};

// Texas Kindergarten reading briefs — practice-only (STAAR doesn't
// test K reading). Very short passages, very simple sentences,
// concrete topics a 5-6yo can talk about. No inference questions —
// stick to main idea + key detail + simple "what happened" sequence.
const GK_BRIEFS = [
  // Realistic fiction (5)
  { id: 'gk-rf-bluebonnet-walk', grade: 'k', genre: 'realistic-fiction',
    topic: 'a small kid takes a walk with a parent and points at the first bluebonnet they see all spring',
    setting: 'a Texas neighborhood', protagonistName: 'Mia', protagonistDemographic: 'unmarked' },
  { id: 'gk-rf-pet-the-armadillo', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid sees an armadillo in the yard and learns to stay still and watch quietly so it does not run',
    setting: 'a Texas backyard', protagonistName: 'Sam', protagonistDemographic: 'unmarked' },
  { id: 'gk-rf-galveston-shells', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid finds three different shells on a beach trip and lines them up biggest to smallest',
    setting: 'Galveston beach', protagonistName: 'Ava', protagonistDemographic: 'unmarked' },
  { id: 'gk-rf-rodeo-pony', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid pets a pony at a small petting zoo at the rodeo and decides that ponies feel softer than they look',
    setting: 'a small fair near Houston', protagonistName: 'Luca', protagonistDemographic: 'unmarked' },
  { id: 'gk-rf-bluebird-feeder', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid helps fill a bird feeder and watches a blue bird come visit',
    setting: 'a backyard in Texas', protagonistName: 'Lily', protagonistDemographic: 'unmarked' },

  // Informational (5)
  { id: 'gk-info-armadillo-simple', grade: 'k', genre: 'informational',
    topic: 'simple facts about armadillos: they have a hard shell, they sleep in the day, they roll up if they are scared',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-bluebonnet-flower', grade: 'k', genre: 'informational',
    topic: 'the bluebonnet is the Texas state flower; it blooms in spring; bees like it',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-cowboy-horse', grade: 'k', genre: 'informational',
    topic: 'a cowboy works on a ranch with a horse; cowboys help take care of cows',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-rio-grande-river', grade: 'k', genre: 'informational',
    topic: 'the Rio Grande is a long river in Texas; fish swim in it; people fish from the bank',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-mockingbird', grade: 'k', genre: 'informational',
    topic: 'the mockingbird is the Texas state bird; it can copy other bird songs',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },

  // Round 2: more K depth so the kid doesn't run out
  { id: 'gk-rf-park-picnic', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid goes to a Texas park with family and shares a sandwich with their little brother',
    setting: 'a city park in Texas', protagonistName: 'Jay', protagonistDemographic: 'unmarked' },
  { id: 'gk-rf-rain-puddle', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid jumps in three big puddles after a Texas spring rain and giggles every time',
    setting: 'a sidewalk in Texas after rain', protagonistName: 'Maya', protagonistDemographic: 'unmarked' },
  { id: 'gk-rf-helping-grandma', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid helps grandma make tortillas and learns to roll the dough into a small ball',
    setting: 'grandma’s kitchen in San Antonio', protagonistName: 'Sofia', protagonistDemographic: 'hispanic-latino' },
  { id: 'gk-rf-school-show-tell', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid brings a smooth river rock to show-and-tell and explains where they found it',
    setting: 'a Texas kindergarten classroom', protagonistName: 'Eli', protagonistDemographic: 'unmarked' },
  { id: 'gk-info-pecan-tree-simple', grade: 'k', genre: 'informational',
    topic: 'pecan trees grow in Texas; their nuts come in a hard shell; squirrels eat them',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-frog-pond', grade: 'k', genre: 'informational',
    topic: 'frogs in Texas live near ponds; they eat bugs; they say ribbit',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-yellow-rose', grade: 'k', genre: 'informational',
    topic: 'the yellow rose of Texas is a famous flower; it grows in many colors but yellow is most known',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-watermelon-summer', grade: 'k', genre: 'informational',
    topic: 'watermelons grow in Texas in the summer; they have green skin and pink inside; they are sweet and full of water',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },

  // ----- K v3 — six more briefs (3 RF + 3 INFO) -----
  { id: 'gk-rf-paper-cup-seed', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid plants a flower seed in a paper cup at school and waits each day to see if a green sprout will pop up',
    setting: 'a Texas kindergarten classroom', protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-rf-rolly-polly-yard', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid finds a rolly polly bug under a rock in the backyard and watches it curl up into a tiny ball',
    setting: 'a Texas backyard', protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-rf-cowboy-boots', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid puts on their first pair of cowboy boots before going to a Texas country fair and hops to make sure they fit',
    setting: 'a Texas county-fair gate', protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-prickly-pear', grade: 'k', genre: 'informational',
    topic: 'prickly pear is a Texas cactus with flat green pads, sharp spines, and red fruit you can eat after the spines come off',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-bbq-smoker', grade: 'k', genre: 'informational',
    topic: 'a Texas barbecue smoker is a metal box that uses wood and slow heat to cook meat for a long time and make it smell good',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-horned-lizard-simple', grade: 'k', genre: 'informational',
    topic: 'the horned lizard is a small Texas lizard with little horns on its head; it likes hot rocks and eats ants',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },

  // ----- K v4 — six more briefs (3 RF + 3 INFO) -----
  { id: 'gk-rf-shoes-on-self', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid puts on their own shoes for the first time without help; they get the right shoe on the right foot after one try with the left',
    setting: 'a Texas kindergarten classroom door', protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-rf-tortilla-rolling', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid helps abuela press tortillas in a quiet kitchen; the kid learns to flip the dough so it does not stick',
    setting: 'an abuela\'s kitchen in El Paso', protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-rf-found-feather', grade: 'k', genre: 'realistic-fiction',
    topic: 'a kid finds a soft brown feather on the playground and tucks it behind their ear like a hat band',
    setting: 'a Texas elementary school playground', protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-firetruck-red', grade: 'k', genre: 'informational',
    topic: 'firetrucks are big red trucks that bring water to put out fires; they have ladders, hoses, and loud sirens that help everyone get out of the way',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-honey-bees', grade: 'k', genre: 'informational',
    topic: 'honey bees fly from flower to flower; they bring pollen back to their hive and turn it into sweet honey we can eat',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'gk-info-tx-state-snack', grade: 'k', genre: 'informational',
    topic: 'tortilla chips and salsa are the official Texas state snack; people scoop salsa with a chip and crunch — many Texans eat this snack at home and at restaurants',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' }
];

// Texas Grade 1 reading briefs — early reader, slightly longer.
const G1_BRIEFS = [
  // Realistic fiction (5)
  { id: 'g1-rf-first-rodeo', grade: '1', genre: 'realistic-fiction',
    topic: 'a kid goes to their first small-town rodeo and learns the names of three rodeo events',
    setting: 'a small-town rodeo in Central Texas', protagonistName: 'Rosa', protagonistDemographic: 'hispanic-latino' },
  { id: 'g1-rf-fishing-with-grandpa', grade: '1', genre: 'realistic-fiction',
    topic: 'a kid goes fishing at a small Texas lake with grandpa and catches a tiny perch they have to throw back',
    setting: 'a small lake near Tyler', protagonistName: 'Theo', protagonistDemographic: 'unmarked' },
  { id: 'g1-rf-bus-to-school', grade: '1', genre: 'realistic-fiction',
    topic: 'a kid rides the bus to first grade for the first time and figures out which seat is theirs',
    setting: 'a Texas elementary school bus stop', protagonistName: 'Kai', protagonistDemographic: 'asian' },
  { id: 'g1-rf-tomato-garden', grade: '1', genre: 'realistic-fiction',
    topic: "a kid waters their tomato plants every day and the day comes when the first red one is ready to pick",
    setting: 'a Texas backyard garden', protagonistName: 'Jada', protagonistDemographic: 'black' },
  { id: 'g1-rf-hill-country-deer', grade: '1', genre: 'realistic-fiction',
    topic: 'a kid sees a deer in the front yard and stays very still until the deer walks back into the trees',
    setting: 'a house in the Hill Country', protagonistName: 'Henry', protagonistDemographic: 'unmarked' },

  // Informational (5)
  { id: 'g1-info-bluebonnet-explain', grade: '1', genre: 'informational',
    topic: 'why the bluebonnet is the Texas state flower; when it blooms; why people drive out to see fields of them',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g1-info-longhorns-state-animal', grade: '1', genre: 'informational',
    topic: 'the Texas longhorn is the state large mammal; what its horns look like; why ranchers raised them long ago',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g1-info-bats-austin', grade: '1', genre: 'informational',
    topic: 'bats sleep under a bridge in Austin all day, then fly out at night to eat bugs',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g1-info-pecan-tree', grade: '1', genre: 'informational',
    topic: 'pecan trees grow in Texas; their nuts are good to eat; squirrels like them too',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g1-info-gulf-of-mexico', grade: '1', genre: 'informational',
    topic: 'the Gulf of Mexico touches the Texas coast; people swim there; sea turtles live there',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },

  // Round 2: more Grade 1 depth
  { id: 'g1-rf-library-card', grade: '1', genre: 'realistic-fiction',
    topic: "a kid gets their first library card and picks out three books to take home",
    setting: 'a public library in Houston', protagonistName: 'Olivia', protagonistDemographic: 'unmarked' },
  { id: 'g1-rf-soccer-first-goal', grade: '1', genre: 'realistic-fiction',
    topic: "a kid scores their first goal at a Saturday morning soccer game and the whole team cheers",
    setting: 'a youth soccer field in Plano', protagonistName: 'Diego', protagonistDemographic: 'hispanic-latino' },
  { id: 'g1-rf-class-pet-fish', grade: '1', genre: 'realistic-fiction',
    topic: "a kid takes their turn feeding the class fish and learns it only needs a tiny pinch of food",
    setting: 'a first-grade classroom in Texas', protagonistName: 'Zoe', protagonistDemographic: 'unmarked' },
  { id: 'g1-rf-sandcastle-galveston', grade: '1', genre: 'realistic-fiction',
    topic: "a kid builds the biggest sandcastle they can on a Galveston beach trip",
    setting: 'Galveston beach', protagonistName: 'Noah', protagonistDemographic: 'unmarked' },
  { id: 'g1-info-roadrunner', grade: '1', genre: 'informational',
    topic: 'the roadrunner is a Texas bird that runs fast on the ground; it eats lizards and snakes; it can fly but mostly runs',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g1-info-cactus-water', grade: '1', genre: 'informational',
    topic: 'cactus plants in Texas store water inside; they have spines that protect them; they can live where it does not rain much',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g1-info-fire-ants', grade: '1', genre: 'informational',
    topic: 'fire ants in Texas live in mounds; they help break down dead leaves; they sting if you bother them',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g1-info-thunderstorm', grade: '1', genre: 'informational',
    topic: 'thunderstorms in Texas have big clouds; the lightning makes the loud thunder sound; it is best to go inside',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },

  // ----- G1 v3 — six more briefs (3 RF + 3 INFO) -----
  { id: 'g1-rf-bluebonnet-window', grade: '1', genre: 'realistic-fiction',
    topic: 'a kid waits for the bluebonnet bloom outside their classroom window and sees the first blue petal one Monday morning',
    setting: 'a first-grade classroom in the Texas Hill Country', protagonistName: 'Camila', protagonistDemographic: 'hispanic-latino' },
  { id: 'g1-rf-bike-driveway', grade: '1', genre: 'realistic-fiction',
    topic: 'a kid learns to ride a bike in the driveway with mom holding on; mom lets go for a few seconds and the kid keeps going',
    setting: 'a Texas suburb driveway', protagonistName: 'Jordan', protagonistDemographic: 'unmarked' },
  { id: 'g1-rf-quinceanera-dance', grade: '1', genre: 'realistic-fiction',
    topic: 'a kid attends a cousin\'s quinceañera and figures out where to sit at the family table after the first dance',
    setting: 'a quinceañera at a community hall in San Antonio', protagonistName: 'Mateo', protagonistDemographic: 'hispanic-latino' },
  { id: 'g1-info-tx-capitol', grade: '1', genre: 'informational',
    topic: 'the Texas Capitol building in Austin has pink granite walls, a gold star on top of the dome, and is taller than the U.S. Capitol',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g1-info-horned-lizard-state-reptile', grade: '1', genre: 'informational',
    topic: 'the horned lizard is the official Texas state reptile; it puffs up its body to look bigger and scare birds away',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g1-info-chili-state-dish', grade: '1', genre: 'informational',
    topic: 'chili is the Texas state dish; it is a thick stew made of beef, beans, peppers, and spices, and it warms you up on cold days',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },

  // ----- G1 v4 — six more briefs (3 RF + 3 INFO) -----
  { id: 'g1-rf-lost-jacket', grade: '1', genre: 'realistic-fiction',
    topic: 'a kid loses their jacket on the school playground at recess; their teacher walks them through three places to check until they find it on the slide',
    setting: 'a Texas elementary school playground', protagonistName: 'Sofia', protagonistDemographic: 'hispanic-latino' },
  { id: 'g1-rf-fishing-piers', grade: '1', genre: 'realistic-fiction',
    topic: 'a kid goes to a Texas Gulf coast fishing pier with their uncle and learns how to put a worm on the hook without flinching',
    setting: 'a fishing pier near Corpus Christi', protagonistName: 'Beto', protagonistDemographic: 'hispanic-latino' },
  { id: 'g1-rf-spelling-bee-letter', grade: '1', genre: 'realistic-fiction',
    topic: 'a kid practices for the first-grade classroom spelling bee; they trip on the letter "y" in "yellow" but spell it right after a deep breath',
    setting: 'a first-grade classroom in San Antonio', protagonistName: 'DaShawn', protagonistDemographic: 'black' },
  { id: 'g1-info-tx-state-fruit', grade: '1', genre: 'informational',
    topic: 'the red grapefruit is the Texas state fruit; it grows in the Rio Grande Valley where the warm sun and rich soil make the fruit extra sweet',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g1-info-tx-state-pepper', grade: '1', genre: 'informational',
    topic: 'the chiltepin is the Texas state native pepper; it is a tiny round pepper that grows wild in South Texas and is one of the spiciest peppers in the world',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g1-info-cottonwood-tree', grade: '1', genre: 'informational',
    topic: 'cottonwood trees grow tall along Texas creeks and rivers; in spring their seeds drift through the air on white fluff that looks like cotton, which is how they got their name',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' }
];

// Texas Grade 2 reading briefs — full sentences, clear paragraphs.
const G2_BRIEFS = [
  // Realistic fiction (6)
  { id: 'g2-rf-houston-zoo', grade: '2', genre: 'realistic-fiction',
    topic: 'a kid visits the Houston Zoo with their class and notices that the elephants seem to know their keepers',
    setting: 'Houston Zoo', protagonistName: 'Marcus', protagonistDemographic: 'black' },
  { id: 'g2-rf-bluebonnet-photo', grade: '2', genre: 'realistic-fiction',
    topic: "a kid takes a parent's phone and tries to take a photo of a bluebonnet field, learning to hold the camera steady",
    setting: 'a roadside in the Hill Country', protagonistName: 'Aanya', protagonistDemographic: 'asian' },
  { id: 'g2-rf-rio-grande-walk', grade: '2', genre: 'realistic-fiction',
    topic: "a kid takes a slow walk with grandma along the Rio Grande and counts the kinds of birds they see",
    setting: 'a riverside trail near McAllen', protagonistName: 'Camila', protagonistDemographic: 'hispanic-latino' },
  { id: 'g2-rf-state-fair-funnel', grade: '2', genre: 'realistic-fiction',
    topic: 'a kid eats their first funnel cake at the State Fair of Texas and decides next year they want to try the corny dog',
    setting: 'State Fair of Texas in Dallas', protagonistName: 'Ethan', protagonistDemographic: 'unmarked' },
  { id: 'g2-rf-school-pet-frog', grade: '2', genre: 'realistic-fiction',
    topic: "a kid gets to take care of the class pet frog over a long weekend and writes notes about everything the frog does",
    setting: 'a Texas elementary school classroom', protagonistName: 'Imani', protagonistDemographic: 'black' },
  { id: 'g2-rf-bracken-bats-watch', grade: '2', genre: 'realistic-fiction',
    topic: "a kid waits with grandparents at sunset to watch bats fly out from a Texas cave",
    setting: 'a bat cave near San Antonio', protagonistName: 'Diego', protagonistDemographic: 'hispanic-latino' },

  // Informational (6)
  { id: 'g2-info-armadillo-facts', grade: '2', genre: 'informational',
    topic: 'three things about Texas armadillos: their hard shell, what they eat (insects), and why they jump straight up when scared',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g2-info-state-symbols-trio', grade: '2', genre: 'informational',
    topic: 'three Texas state symbols a second-grader should know: bluebonnet (flower), mockingbird (bird), and pecan (tree). What each one is and why it was chosen',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g2-info-cowboy-job', grade: '2', genre: 'informational',
    topic: "what a real Texas cowboy's job looks like today: riding a horse, moving cattle between pastures, fixing fences",
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g2-info-summer-storms-simple', grade: '2', genre: 'informational',
    topic: 'why thunder rolls so loud in summer Texas storms: hot air rises fast, cool air falls, and lightning makes the loud sound',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g2-info-coast-shorebird-three', grade: '2', genre: 'informational',
    topic: 'three Texas coast birds (great blue heron, brown pelican, gull) and one cool thing each one does to find food',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g2-info-prickly-pear-cactus', grade: '2', genre: 'informational',
    topic: 'how a prickly pear cactus stores water in its thick paddles and why that helps it live where rain is rare',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },

  // Round 2: more Grade 2 depth
  { id: 'g2-rf-paint-class-mural', grade: '2', genre: 'realistic-fiction',
    topic: "a kid helps paint part of their classroom mural and discovers that the right brush makes a big difference",
    setting: 'a Texas elementary school art class', protagonistName: 'Jada', protagonistDemographic: 'black' },
  { id: 'g2-rf-camping-bigthicket', grade: '2', genre: 'realistic-fiction',
    topic: "a kid sleeps in a tent for the first time on a family camping trip in the Big Thicket and listens to the night sounds",
    setting: 'Big Thicket National Preserve, East Texas', protagonistName: 'Hiro', protagonistDemographic: 'asian' },
  { id: 'g2-rf-feeding-chickens', grade: '2', genre: 'realistic-fiction',
    topic: "a kid visits cousins on a small Hill Country farm and learns to scatter chicken feed evenly so all the chickens get some",
    setting: 'a small farm in the Hill Country', protagonistName: 'Levi', protagonistDemographic: 'unmarked' },
  { id: 'g2-rf-water-conservation-poster', grade: '2', genre: 'realistic-fiction',
    topic: "a kid in second grade makes a poster for a school water-conservation contest and learns three ways to save water at home",
    setting: 'a Texas elementary school', protagonistName: 'Aaliyah', protagonistDemographic: 'black' },
  { id: 'g2-rf-spelling-bee-prep', grade: '2', genre: 'realistic-fiction',
    topic: "a kid practices for the second-grade spelling bee with a parent and learns a trick for remembering hard words",
    setting: 'a kitchen table in Austin', protagonistName: 'Camila', protagonistDemographic: 'hispanic-latino' },
  { id: 'g2-info-rivers-three', grade: '2', genre: 'informational',
    topic: 'three Texas rivers a second-grader should know — the Rio Grande (border), the Brazos (longest in Texas), and the Colorado (runs through Austin)',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g2-info-state-fish-bass', grade: '2', genre: 'informational',
    topic: 'the Guadalupe bass is the Texas state fish; it lives in clear Hill Country streams; it is found nowhere else in the world',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g2-info-monarch-butterfly', grade: '2', genre: 'informational',
    topic: 'monarch butterflies fly through Texas every fall on their way to Mexico; they need milkweed plants to lay their eggs; their long trip takes weeks',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },

  // ----- G2 v3 — six more briefs (3 RF + 3 INFO) -----
  { id: 'g2-rf-4h-meeting', grade: '2', genre: 'realistic-fiction',
    topic: 'a kid joins their first 4-H meeting in a small Texas town and learns what each of the four H\'s stand for and why members say a pledge',
    setting: 'a 4-H club meeting in a small East Texas town', protagonistName: 'Aaliyah', protagonistDemographic: 'black' },
  { id: 'g2-rf-flat-tire-park', grade: '2', genre: 'realistic-fiction',
    topic: 'a kid helps dad fix a flat bike tire at a Texas city park; together they find the small thorn that caused the leak',
    setting: 'a city park in Houston', protagonistName: 'Diego', protagonistDemographic: 'hispanic-latino' },
  { id: 'g2-rf-backyard-tent', grade: '2', genre: 'realistic-fiction',
    topic: 'a kid camps out one night in the backyard with a tent and a flashlight; coyotes howl in the distance and the kid feels proud they stayed all night',
    setting: 'a backyard outside Austin', protagonistName: 'Priya', protagonistDemographic: 'south-asian' },
  { id: 'g2-info-austin-bats', grade: '2', genre: 'informational',
    topic: 'every summer evening, around one and a half million bats fly out from under the Congress Avenue Bridge in Austin to hunt for insects; people gather on the bridge to watch',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g2-info-longhorn-horns', grade: '2', genre: 'informational',
    topic: 'the Texas longhorn is a kind of cattle whose horns can grow more than nine feet wide — wider than most cars are long; the longhorn is the official Texas state large mammal',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g2-info-big-bend-region', grade: '2', genre: 'informational',
    topic: 'Big Bend is a region in far west Texas where the Rio Grande river makes a giant U-shaped turn; the area has tall mountains, deep canyons, and many wild animals',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' }
];

// Texas Grade 3 reading briefs. Mix of realistic-fiction + informational;
// all kid-grounded, Texas-rooted, §9-clean. Diverse settings (5 regions)
// and protagonist demographics.
const G3_BRIEFS = [
  // ----- Realistic fiction (12) -----
  { id: 'g3-rf-bluebonnets-spring', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid notices the first bluebonnets of spring on a family drive and decides to keep a wildflower journal',
    setting: 'Hill Country highway between Austin and Fredericksburg',
    protagonistName: 'Lucia', protagonistDemographic: 'hispanic-latino' },
  { id: 'g3-rf-rio-grande-fishing', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid goes fishing with grandparent on the Rio Grande for the first time and learns to be patient',
    setting: 'McAllen area along the Rio Grande',
    protagonistName: 'Mateo', protagonistDemographic: 'hispanic-latino' },
  { id: 'g3-rf-galveston-seawall', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid spots a baby sea turtle nest on Galveston Beach and helps a volunteer protect it',
    setting: 'Galveston Island',
    protagonistName: 'Jamal', protagonistDemographic: 'black' },
  { id: 'g3-rf-bigbend-stargazing', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid camping at Big Bend looks up at a night sky with no city lights and counts more stars than they have ever seen',
    setting: 'Big Bend National Park, West Texas',
    protagonistName: 'Aaliyah', protagonistDemographic: 'black' },
  { id: 'g3-rf-houston-rodeo', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid goes to the Houston Livestock Show and Rodeo for the first time and decides to learn how to braid a horse mane',
    setting: 'Houston during rodeo season',
    protagonistName: 'Priya', protagonistDemographic: 'asian' },
  { id: 'g3-rf-lubbock-farmers-market', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid helps grandparents sell honey at a Lubbock farmers market and learns that bees do most of the work',
    setting: 'a Saturday farmers market in Lubbock',
    protagonistName: 'Caleb', protagonistDemographic: 'unmarked' },
  { id: 'g3-rf-elpaso-science-fair', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid in El Paso enters a school science fair with a project about how cactus plants store water',
    setting: 'an elementary school in El Paso',
    protagonistName: 'Diego', protagonistDemographic: 'hispanic-latino' },
  { id: 'g3-rf-corpus-christi-cousins', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid visits cousins in Corpus Christi for a week and learns to bodyboard in the Gulf',
    setting: 'Corpus Christi, on the Gulf coast',
    protagonistName: 'Salma', protagonistDemographic: 'other-named' },
  { id: 'g3-rf-czech-kolaches', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid spends a Saturday helping a great-aunt bake kolaches for the first time and learns the family recipe is older than the kid is',
    setting: 'a Czech-heritage town in central Texas (West, TX)',
    protagonistName: 'Aiden', protagonistDemographic: 'unmarked' },
  { id: 'g3-rf-brazos-bend-alligator', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid sees a real alligator at Brazos Bend State Park while on a family bike ride and learns the right way to keep distance',
    setting: 'Brazos Bend State Park near Houston',
    protagonistName: 'Ethan', protagonistDemographic: 'unmarked' },
  { id: 'g3-rf-san-antonio-river-walk', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid takes a riverboat tour with grandparents on the San Antonio River Walk and notices how stone bridges have different shapes',
    setting: 'San Antonio River Walk',
    protagonistName: 'Yusuf', protagonistDemographic: 'other-named' },
  { id: 'g3-rf-mcdonald-observatory', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid visits the McDonald Observatory star party with a parent and looks through a real telescope at the rings of Saturn',
    setting: 'Davis Mountains, West Texas',
    protagonistName: 'Hadley', protagonistDemographic: 'unmarked' },

  // ----- Informational (12) -----
  { id: 'g3-info-armadillos', grade: 3, genre: 'informational',
    topic: 'why nine-banded armadillos are so common in Texas — what they eat, where they live, why they roll up',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-staar-bats', grade: 3, genre: 'informational',
    topic: 'the Mexican free-tailed bats that fly out from the Congress Avenue Bridge in Austin every summer evening',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-pecan-state-tree', grade: 3, genre: 'informational',
    topic: 'how the pecan tree became the Texas state tree and why pecans are part of Texas family traditions',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-state-symbols', grade: 3, genre: 'informational',
    topic: 'three official Texas state symbols a third-grader should know — the bluebonnet, the mockingbird, and the Texas longhorn — and what each one is',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-johnson-space-center', grade: 3, genre: 'informational',
    topic: "what NASA's Johnson Space Center in Houston does — training astronauts, mission control, and the moon-rock collection",
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-edwards-aquifer', grade: 3, genre: 'informational',
    topic: 'the Edwards Aquifer — what an aquifer is, how rainwater fills it, and why San Antonio depends on it',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-whooping-cranes', grade: 3, genre: 'informational',
    topic: 'whooping cranes that fly to the Texas coast every winter — where they nest in summer, why they almost disappeared, and how they made a comeback',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-summer-storms', grade: 3, genre: 'informational',
    topic: 'why summer thunderstorms in Texas can be so big — the warm Gulf of Mexico, the cool dry air from the north, and what happens when they meet',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-prickly-pear', grade: 3, genre: 'informational',
    topic: 'the prickly pear cactus — how it stores water, how it survives the West Texas heat, and how its fruit is used in food and medicine',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-spanish-place-names', grade: 3, genre: 'informational',
    topic: 'why so many Texas cities have Spanish names — three examples (San Antonio, El Paso, Amarillo) and what each name means',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-longhorns-cattle-drives', grade: 3, genre: 'informational',
    topic: 'Texas longhorns and the cattle drives of the late 1800s — why the breed survived, the long trails north, and the cowboys who rode them',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-texas-coast-shorebirds', grade: 3, genre: 'informational',
    topic: 'four shorebirds you can spot on the Texas coast (great blue heron, brown pelican, sandpiper, snowy egret) and how each one finds food',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },

  // ----- G3 v2 — six more briefs (3 RF + 3 INFO) -----
  { id: 'g3-rf-dog-sit-trick', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid trains their dog to sit before suppertime; after a week of practice the dog sits without a treat for the first time',
    setting: 'a Houston suburb backyard', protagonistName: 'Marcus', protagonistDemographic: 'black' },
  { id: 'g3-rf-pico-de-gallo-abuela', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid learns to make pico de gallo with their abuela in a McAllen kitchen, chopping tomatoes and onions while listening to the older stories of the family ranch',
    setting: 'an abuela\'s kitchen in McAllen', protagonistName: 'Luna', protagonistDemographic: 'hispanic-latino' },
  { id: 'g3-rf-field-trip-lunch', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid forgets their lunch on a school field trip to a Fort Worth museum; a friend offers half a turkey sandwich and the kid learns that asking for help is okay',
    setting: 'a school field trip in Fort Worth', protagonistName: 'Ahmed', protagonistDemographic: 'middle-eastern' },
  { id: 'g3-info-state-fair-big-tex', grade: 3, genre: 'informational',
    topic: 'the State Fair of Texas runs every fall in Dallas; Big Tex, a 55-foot-tall talking cowboy statue, greets visitors at the front gate; the fair is famous for fried foods and prize-winning livestock',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-pelicans-gulf-coast', grade: 3, genre: 'informational',
    topic: 'brown pelicans on the Texas Gulf Coast dive from the air to catch fish in their stretchy throat pouch; they were once nearly gone but came back after pesticides were banned',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-trinity-river', grade: 3, genre: 'informational',
    topic: 'the Trinity River runs more than 700 miles through Texas, flowing past Fort Worth and Dallas before reaching the Gulf of Mexico near Galveston Bay; cities depend on the river for drinking water',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },

  // ----- G3 v3 — six more briefs (3 RF + 3 INFO) -----
  { id: 'g3-rf-soccer-tryout', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid tries out for the school soccer team in Austin; they miss their first shot but make the second by remembering to keep their eyes on the ball',
    setting: 'a school soccer field in Austin', protagonistName: 'Andre', protagonistDemographic: 'black' },
  { id: 'g3-rf-grandmother-photo-album', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid spends a rainy afternoon looking through their grandmother\'s photo album and learns that grandma grew up on a small West Texas ranch with no running water',
    setting: 'a grandmother\'s living room in Lubbock', protagonistName: 'Elena', protagonistDemographic: 'hispanic-latino' },
  { id: 'g3-rf-helping-after-storm', grade: 3, genre: 'realistic-fiction',
    topic: 'a kid helps neighbors clean up fallen branches and trash after a Texas thunderstorm; they fill four big bags and feel proud when the street looks normal again',
    setting: 'a suburban street in Houston', protagonistName: 'Min-Jun', protagonistDemographic: 'asian' },
  { id: 'g3-info-tx-economy-three-industries', grade: 3, genre: 'informational',
    topic: 'three of the biggest industries in Texas — cattle ranching (raising beef), oil and gas (drilling for fuel), and technology (computer chips and software in cities like Austin) — and how each one provides jobs',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-pecan-state-tree-harvest', grade: 3, genre: 'informational',
    topic: 'the pecan is the official Texas state tree; pecan trees grow nuts inside green hulls that ripen in fall, and Texas farmers harvest millions of pounds of pecans every year for pies and other foods',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g3-info-juneteenth-history', grade: 3, genre: 'informational',
    topic: 'Juneteenth, June 19, marks the day in 1865 when enslaved people in Galveston, Texas first heard they were free; it began as a Texas tradition and is now a national holiday celebrating freedom and heritage',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' }
];

// Texas Grade 4 reading briefs. Slightly older protagonists (~9-10),
// longer passages, more vocabulary, less "first-time" framing.
const G4_BRIEFS = [
  // ----- Realistic fiction (9) -----
  { id: 'g4-rf-padre-island-kayak', grade: 4, genre: 'realistic-fiction',
    topic: 'a kid kayaks with a parent for the first time in the Laguna Madre and watches a sea turtle surface near the boat',
    setting: 'Padre Island National Seashore',
    protagonistName: 'Naomi', protagonistDemographic: 'unmarked' },
  { id: 'g4-rf-fort-worth-stockyards', grade: 4, genre: 'realistic-fiction',
    topic: 'a kid visiting the Fort Worth Stockyards with cousins watches the daily cattle drive and decides to write a report on the chuckwagon cook',
    setting: 'Fort Worth Stockyards',
    protagonistName: 'Marcus', protagonistDemographic: 'black' },
  { id: 'g4-rf-amarillo-cadillac-ranch', grade: 4, genre: 'realistic-fiction',
    topic: 'a kid stops at Cadillac Ranch on a road trip and adds a small painted handprint to one of the cars, leaving family permission',
    setting: 'Cadillac Ranch outside Amarillo',
    protagonistName: 'Luna', protagonistDemographic: 'unmarked' },
  { id: 'g4-rf-pioneer-museum-volunteer', grade: 4, genre: 'realistic-fiction',
    topic: 'a kid volunteers one Saturday at a small Texas pioneer museum and helps a docent label old farm tools that nobody uses anymore',
    setting: 'a small-town pioneer museum in central Texas',
    protagonistName: 'Imani', protagonistDemographic: 'black' },
  { id: 'g4-rf-prairie-park-bird-count', grade: 4, genre: 'realistic-fiction',
    topic: 'a kid joins a bird count at a Dallas prairie park and learns to tell painted buntings from indigo buntings',
    setting: 'a tallgrass prairie park near Dallas',
    protagonistName: 'Theo', protagonistDemographic: 'unmarked' },
  { id: 'g4-rf-galveston-storm-cleanup', grade: 4, genre: 'realistic-fiction',
    topic: 'a kid joins a beach cleanup the day after a tropical storm passes by Galveston and learns what kinds of trash the waves leave behind',
    setting: 'East Beach, Galveston',
    protagonistName: 'Salma', protagonistDemographic: 'other-named' },
  { id: 'g4-rf-tejano-music-festival', grade: 4, genre: 'realistic-fiction',
    topic: 'a kid goes to a Tejano music festival in San Antonio with extended family and notices how three generations dance together',
    setting: 'a Tejano music festival in San Antonio',
    protagonistName: 'Cristian', protagonistDemographic: 'hispanic-latino' },
  { id: 'g4-rf-dinosaur-valley-tracks', grade: 4, genre: 'realistic-fiction',
    topic: 'a kid finds real dinosaur tracks in the riverbed at Dinosaur Valley State Park and tries to figure out which dinosaur made them',
    setting: 'Dinosaur Valley State Park',
    protagonistName: 'Levi', protagonistDemographic: 'unmarked' },
  { id: 'g4-rf-east-texas-piney-woods', grade: 4, genre: 'realistic-fiction',
    topic: 'a kid goes hiking with a parent in the Piney Woods of East Texas and identifies five different kinds of pinecones',
    setting: 'Sam Houston National Forest',
    protagonistName: 'Aanya', protagonistDemographic: 'asian' },

  // ----- Informational (9) -----
  { id: 'g4-info-deep-eddy-pool', grade: 4, genre: 'informational',
    topic: 'Deep Eddy Pool in Austin — how spring-fed pools stay cool year-round, why the temperature stays so steady, and how the pool was built',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g4-info-padre-sea-turtles', grade: 4, genre: 'informational',
    topic: "Kemp's ridley sea turtles on the Texas coast — what they eat, the patrol that protects nests, and why they almost went extinct",
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g4-info-spindletop-oil', grade: 4, genre: 'informational',
    topic: 'Spindletop and the start of the Texas oil boom — what a "gusher" is and how one well changed the state',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g4-info-monarch-migration', grade: 4, genre: 'informational',
    topic: 'monarch butterflies passing through Texas on their migration to Mexico — the milkweed connection, where they stop to rest, and how scientists track them',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g4-info-paisano-roadrunner', grade: 4, genre: 'informational',
    topic: 'the greater roadrunner ("paisano") — how fast it actually runs, what it eats, and why people sometimes call it a "snake-killer"',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g4-info-cap-rock-escarpment', grade: 4, genre: 'informational',
    topic: 'the Caprock Escarpment in West Texas — how the cliff line was carved by erosion, why the land changes from flat plains to canyons, and what fossils you can find there',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g4-info-hill-country-springs', grade: 4, genre: 'informational',
    topic: 'how Hill Country springs work — limestone, the Edwards Aquifer recharge zone, and why some rivers seem to start out of nowhere',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g4-info-texas-longhorns-history', grade: 4, genre: 'informational',
    topic: 'how the Texas longhorn breed almost disappeared in the 1900s and how a few ranchers brought the cattle back',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g4-info-padre-island-storms', grade: 4, genre: 'informational',
    topic: 'why Texas barrier islands like Padre Island change shape after big storms — sand movement, beach erosion, and what scientists track over the years',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' }
];

// Texas Grade 5 reading briefs — STAAR-tested. Older protagonists,
// more nuance, multi-paragraph evidence, more sophisticated vocabulary.
const G5_BRIEFS = [
  // Realistic fiction (8)
  { id: 'g5-rf-mockingbird-mom-flute', grade: 5, genre: 'realistic-fiction',
    topic: "a kid practicing flute on a Sunday morning notices a mockingbird outside imitating the same notes back, and starts a duet that lasts an hour",
    setting: 'a backyard in Austin', protagonistName: 'Camila', protagonistDemographic: 'hispanic-latino' },
  { id: 'g5-rf-friday-night-lights', grade: 5, genre: 'realistic-fiction',
    topic: 'a kid whose older sibling is the high school band drum major figures out how to memorize all the field formations from the press box',
    setting: 'a small-town Texas football stadium on a Friday night',
    protagonistName: 'Quincy', protagonistDemographic: 'black' },
  { id: 'g5-rf-blanco-river-tubing', grade: 5, genre: 'realistic-fiction',
    topic: "a kid's first time tubing on the Blanco River — they grip the tube too tight at first, then relax and float through three small rapids",
    setting: 'the Blanco River near Wimberley',
    protagonistName: 'Aanya', protagonistDemographic: 'asian' },
  { id: 'g5-rf-fossil-hunt-glen-rose', grade: 5, genre: 'realistic-fiction',
    topic: 'a kid on a school field trip to Dinosaur Valley spots a real fossil rib bone in a streambed and learns the rules about what to leave behind',
    setting: 'Dinosaur Valley State Park near Glen Rose',
    protagonistName: 'Kennedy', protagonistDemographic: 'unmarked' },
  { id: 'g5-rf-bracken-bat-cave', grade: 5, genre: 'realistic-fiction',
    topic: 'a kid attends an evening tour at Bracken Cave and watches the bat emergence — millions of bats spiraling out — for the first time',
    setting: 'Bracken Cave near San Antonio',
    protagonistName: 'Marcus', protagonistDemographic: 'black' },
  { id: 'g5-rf-fort-davis-history', grade: 5, genre: 'realistic-fiction',
    topic: "a kid visits Fort Davis with a parent and learns about the Buffalo Soldiers who served there in the 1800s",
    setting: 'Fort Davis National Historic Site',
    protagonistName: 'Imani', protagonistDemographic: 'black' },
  { id: 'g5-rf-mariachi-school-band', grade: 5, genre: 'realistic-fiction',
    topic: "a kid joins their school's mariachi program and has to choose between violin and trumpet for their tryout",
    setting: 'an elementary school in Brownsville',
    protagonistName: 'Logan', protagonistDemographic: 'unmarked' },
  { id: 'g5-rf-galveston-monarchs', grade: 5, genre: 'realistic-fiction',
    topic: 'a kid on the Texas coast tags monarch butterflies for a citizen-science program with a parent and a wildlife biologist',
    setting: 'Galveston Island during fall migration',
    protagonistName: 'Salma', protagonistDemographic: 'other-named' },

  // Informational (8)
  { id: 'g5-info-johnson-space-mission', grade: 5, genre: 'informational',
    topic: "how astronauts train for spacewalks at NASA's Johnson Space Center — the giant pool called the Neutral Buoyancy Lab and how working underwater feels like working in space",
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g5-info-windmills-and-aermotor', grade: 5, genre: 'informational',
    topic: 'how windmills changed Texas ranching in the late 1800s — the Aermotor windmill, water tables, and how a small invention let cattle ranches expand',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g5-info-galveston-1900-storm', grade: 5, genre: 'informational',
    topic: 'how the city of Galveston rebuilt after the 1900 hurricane — the seawall, the grade-raising project, and what the city looks like today',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g5-info-llano-uplift-rocks', grade: 5, genre: 'informational',
    topic: 'the Llano Uplift in Central Texas — how the oldest rocks in the state ended up at the surface and why geologists travel from far away to study them',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g5-info-prairie-fire-ecology', grade: 5, genre: 'informational',
    topic: 'why some Texas prairies need wildfires to stay healthy — how grasses adapted, how mesquite would take over without fire, and how scientists do controlled burns',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g5-info-state-fair-history', grade: 5, genre: 'informational',
    topic: 'the State Fair of Texas in Dallas — its 1886 origins, Big Tex, and what makes a state fair different from a county fair',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g5-info-rio-grande-water-sharing', grade: 5, genre: 'informational',
    topic: 'how Texas, New Mexico, and Mexico share Rio Grande water — what a treaty is, why farmers in the Valley care, and how drought makes the math harder',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g5-info-sandhill-cranes', grade: 5, genre: 'informational',
    topic: 'sandhill cranes wintering in the Texas Panhandle — their migration from the Arctic, the habitat they need, and how playa lakes keep them alive',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' }
];

// Texas Grade 6 reading briefs — middle school cognitive level.
const G6_BRIEFS = [
  // Realistic fiction (6)
  { id: 'g6-rf-coding-club', grade: 6, genre: 'realistic-fiction',
    topic: 'a kid in their first year of middle school joins a coding club and learns that the best code is the code you can read three months later',
    setting: 'a middle school in Plano',
    protagonistName: 'Hiro', protagonistDemographic: 'asian' },
  { id: 'g6-rf-music-festival-vendor', grade: 6, genre: 'realistic-fiction',
    topic: "a kid helps run their family's tamale stand at a music festival in Austin and learns to handle a long line without getting flustered",
    setting: 'Zilker Park during a music festival',
    protagonistName: 'Diego', protagonistDemographic: 'hispanic-latino' },
  { id: 'g6-rf-amistad-fishing', grade: 6, genre: 'realistic-fiction',
    topic: 'a kid on a houseboat fishing trip at Lake Amistad with cousins learns the difference between a striped bass and a largemouth bass',
    setting: 'Lake Amistad, near Del Rio',
    protagonistName: 'Aaliyah', protagonistDemographic: 'black' },
  { id: 'g6-rf-tx-debate-club', grade: 6, genre: 'realistic-fiction',
    topic: 'a kid in a middle school speech-and-debate club has to argue the side they disagree with and discovers it makes them a better arguer overall',
    setting: 'a middle school in Houston',
    protagonistName: 'Naomi', protagonistDemographic: 'unmarked' },
  { id: 'g6-rf-mural-project', grade: 6, genre: 'realistic-fiction',
    topic: 'a kid joins a community mural project in their neighborhood and figures out which color of paint shows up on a brick wall and which disappears',
    setting: 'a neighborhood in San Antonio',
    protagonistName: 'Cristian', protagonistDemographic: 'hispanic-latino' },
  { id: 'g6-rf-hill-country-cycling', grade: 6, genre: 'realistic-fiction',
    topic: 'a kid trains for their first 30-mile bike ride in the Hill Country and learns that pacing matters more than top speed',
    setting: 'rolling Hill Country roads near Boerne',
    protagonistName: 'Levi', protagonistDemographic: 'unmarked' },

  // Informational (6)
  { id: 'g6-info-ogallala-aquifer', grade: 6, genre: 'informational',
    topic: 'the Ogallala Aquifer under the Texas Panhandle — how it formed, how fast it is being pumped, and why farmers are switching crops',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g6-info-marfa-lights', grade: 6, genre: 'informational',
    topic: 'the Marfa lights phenomenon — what observers see, the leading scientific explanations, and why the lights have become a tourist draw',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g6-info-bracken-bat-emergence', grade: 6, genre: 'informational',
    topic: 'the Bracken Cave bat colony near San Antonio — the largest mammal gathering on Earth, what 20 million bats eat each night, and how scientists count them',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g6-info-tx-petroleum-engineering', grade: 6, genre: 'informational',
    topic: 'how horizontal drilling changed Texas oil production — the difference between vertical and horizontal wells, what fracking does, and why the Permian Basin matters',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g6-info-mexican-revolution-border', grade: 6, genre: 'informational',
    topic: "how the Mexican Revolution (1910-1920) shaped towns along the Texas border — refugees, families that crossed and stayed, and how border cities grew",
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g6-info-tx-musicians-influence', grade: 6, genre: 'informational',
    topic: 'three Texas-born musicians who influenced American music (Buddy Holly, Selena Quintanilla, Willie Nelson) — what each one created and why their songs still travel',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' }
];

// Texas Grade 7 reading briefs — early-high-school cognitive level.
const G7_BRIEFS = [
  // Realistic fiction (5)
  { id: 'g7-rf-archaeology-club', grade: 7, genre: 'realistic-fiction',
    topic: 'a teen joins an after-school archaeology club and helps catalog Caddo pottery shards a local landowner found, learning what counts as evidence',
    setting: 'a middle school near Nacogdoches',
    protagonistName: 'Ethan', protagonistDemographic: 'unmarked' },
  { id: 'g7-rf-uil-academic', grade: 7, genre: 'realistic-fiction',
    topic: "a teen prepares for the UIL number-sense competition and learns that the trick is recognizing patterns, not raw speed",
    setting: 'a middle school in Lubbock',
    protagonistName: 'Aanya', protagonistDemographic: 'asian' },
  { id: 'g7-rf-quinceanera-photographer', grade: 7, genre: 'realistic-fiction',
    topic: "a teen with their first camera offers to photograph their cousin's quinceañera for free and learns that documentary photography is harder than it looks",
    setting: 'San Antonio',
    protagonistName: 'Mateo', protagonistDemographic: 'hispanic-latino' },
  { id: 'g7-rf-storm-chasing-with-uncle', grade: 7, genre: 'realistic-fiction',
    topic: 'a teen rides along with an amateur storm-chaser uncle on a Panhandle expedition and learns about radar, supercells, and when to turn around',
    setting: 'a stretch of road near Amarillo on a stormy spring afternoon',
    protagonistName: 'Quincy', protagonistDemographic: 'black' },
  { id: 'g7-rf-hueco-tanks-rock-art', grade: 7, genre: 'realistic-fiction',
    topic: 'a teen on a guided hike at Hueco Tanks sees ancient rock paintings and starts a sketchbook of every petroglyph they spot',
    setting: 'Hueco Tanks State Park near El Paso',
    protagonistName: 'Salma', protagonistDemographic: 'other-named' },

  // Informational (5)
  { id: 'g7-info-permian-basin-shale', grade: 7, genre: 'informational',
    topic: 'the Permian Basin oil and gas region — how shale rock holds hydrocarbons, what hydraulic fracturing does at the well level, and what scientists watch for',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g7-info-tx-court-of-appeals', grade: 7, genre: 'informational',
    topic: 'how appeals courts work in Texas — the difference between trial and appellate courts, why opinions are written, and how a single appeals decision can change state policy',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g7-info-cattle-genetics', grade: 7, genre: 'informational',
    topic: 'how Texas A&M scientists use cattle genetics to breed for drought resistance — what a genetic marker is, why heat tolerance is heritable, and what changes over generations',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g7-info-houston-port-trade', grade: 7, genre: 'informational',
    topic: 'why the Port of Houston is one of the largest in the U.S. — the ship channel, what kinds of cargo move through, and what the port means for Texas economy',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g7-info-texas-music-history-tx-troubadour', grade: 7, genre: 'informational',
    topic: 'the Texas troubadour tradition (Townes Van Zandt, Lyle Lovett, Nanci Griffith) — what makes a song a "Texas song" structurally and lyrically',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' }
];

// Texas Grade 8 reading briefs — high-school-prep cognitive level.
const G8_BRIEFS = [
  // Realistic fiction (5)
  { id: 'g8-rf-newspaper-club', grade: 8, genre: 'realistic-fiction',
    topic: 'a teen joins their middle-school newspaper club and reports on the school cafeteria food-waste problem, learning the difference between an opinion piece and a news article',
    setting: 'a middle school in Round Rock',
    protagonistName: 'Yusuf', protagonistDemographic: 'other-named' },
  { id: 'g8-rf-summer-research-internship', grade: 8, genre: 'realistic-fiction',
    topic: "a teen lands a summer research internship at a UT Austin biology lab studying invasive species in the Colorado River and learns lab discipline",
    setting: 'UT Austin biology lab',
    protagonistName: 'Imani', protagonistDemographic: 'black' },
  { id: 'g8-rf-palo-duro-canyon', grade: 8, genre: 'realistic-fiction',
    topic: 'a teen camping at Palo Duro Canyon stays up to watch a meteor shower and writes a long journal entry that becomes their first real piece of writing',
    setting: 'Palo Duro Canyon State Park',
    protagonistName: 'Kennedy', protagonistDemographic: 'unmarked' },
  { id: 'g8-rf-engineering-fair-bridge', grade: 8, genre: 'realistic-fiction',
    topic: "a teen entering a popsicle-stick bridge competition learns that triangulation matters more than the number of sticks they use",
    setting: 'a middle school engineering fair in Frisco',
    protagonistName: 'Hiro', protagonistDemographic: 'asian' },
  { id: 'g8-rf-fort-bliss-history', grade: 8, genre: 'realistic-fiction',
    topic: "a teen visits Fort Bliss with a parent who served there and learns about the soldiers who guarded the western frontier in the 1800s",
    setting: 'Fort Bliss, El Paso',
    protagonistName: 'Marcus', protagonistDemographic: 'black' },

  // Informational (5)
  { id: 'g8-info-tx-constitution-amendments', grade: 8, genre: 'informational',
    topic: 'how the Texas Constitution gets amended — why Texas amends so often (compared to other states), the current count, and what Article V handles',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g8-info-rgv-sabal-palm', grade: 8, genre: 'informational',
    topic: "the Sabal Palm Sanctuary in the Rio Grande Valley — why this corner of Texas hosts species found nowhere else in the U.S. (chachalacas, ocelots, sabal palms) and the conservation work that protects them",
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g8-info-houston-energy-transition', grade: 8, genre: 'informational',
    topic: "Houston's shift toward energy diversification — why a city built on oil is investing in wind, solar, and hydrogen, and what that transition looks like at the company level",
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g8-info-blackland-prairie-loss', grade: 8, genre: 'informational',
    topic: 'the Blackland Prairie of Texas — why less than 1% remains, what made the soil so valuable for farming, and how scientists are trying to restore patches',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' },
  { id: 'g8-info-llano-river-flood', grade: 8, genre: 'informational',
    topic: 'flash floods in the Hill Country — why the geology of the Edwards Plateau makes floods so sudden, the 2018 Llano River flood, and how warning systems have changed since',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked' }
];

const ALL_BRIEFS = [
  ...GK_BRIEFS, ...G1_BRIEFS, ...G2_BRIEFS,
  ...G3_BRIEFS, ...G4_BRIEFS, ...G5_BRIEFS,
  ...G6_BRIEFS, ...G7_BRIEFS, ...G8_BRIEFS
];

let _ddbClient = null, _PutCommand = null, _DocClient = null;
function getDdb() {
  if (_ddbClient) return { ddb: _ddbClient, PutCommand: _PutCommand };
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const lib = require('@aws-sdk/lib-dynamodb');
  _DocClient = lib.DynamoDBDocumentClient;
  _PutCommand = lib.PutCommand;
  _ddbClient = _DocClient.from(new DynamoDBClient({ region: 'us-east-1' }));
  return { ddb: _ddbClient, PutCommand: _PutCommand };
}

function parseArgs(argv) {
  const opts = { dryRun: true, briefId: null, grade: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--write') opts.dryRun = false;
    else if (argv[i] === '--brief-id') opts.briefId = argv[++i];
    else if (argv[i] === '--grade') opts.grade = String(argv[++i]).toLowerCase();
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: run-seed-openai.js [--brief-id <id>] [--grade <k|1..8>] [--write]');
      process.exit(0);
    }
  }
  return opts;
}

async function callOpenAI(systemPrompt, userMessage, apiKey, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        temperature: (opts && typeof opts.temperature === 'number') ? opts.temperature : 0.7,
        max_tokens: (opts && opts.max_tokens) || 2400
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
    }
    return await res.json();
  } finally { clearTimeout(timer); }
}

function buildPassageSystem(grade) {
  const kp = loadKP();
  const sec = kp.sections;
  const band = GRADE_BANDS[String(grade)] || GRADE_BANDS['3'];
  // K/1/2 are pre-STAAR, very early readers. Tighter constraints +
  // explicit sentence-level guidance (the FK target alone isn't enough
  // signal — gpt-4o tends to overshoot to a 6th-grade reading level
  // unless the prompt explicitly caps sentence length).
  const earlyReader = ['k', '1', '2'].includes(String(grade).toLowerCase());
  const earlyReaderRules = earlyReader ? `

== EARLY-READER RULES (HARD — applies to grades K/1/2) ==
- Sentences are SHORT. Average 5-8 words per sentence. Never more than 12 words in a single sentence.
- Vocabulary is concrete and common. No abstract concepts ("preservation", "ecosystem", "recognition"). Use "saving", "the place where animals live", "knowing".
- Use simple subject-verb-object structures. Avoid subordinate clauses.
- Use repetition where natural — early readers learn from rereading the same word in a new context.
- Word count is STRICT (not a suggestion). Stay inside the target range below; OVER-LONG passages are useless for early readers.
` : '';
  return `You are a children's reading-passage writer for a Texas STAAR grade-${grade} practice app. You write passages that match what a kid would see on the actual STAAR test: kid-readable (target Flesch-Kincaid ${band.fk[0]}-${band.fk[1]}), factually grounded, Texas-rooted often but not always, and free of landmines.${earlyReaderRules}

== KP §2 — Passage characteristics ==
${sec.passageCharacteristics || ''}

== KP §6 — Texas cultural priorities ==
${sec.culturalPriorities || ''}

== KP §7 — AI-generation landmines ==
${sec.landmines || ''}

== KP §8 — Reading levels ==
${sec.readingLevels || ''}

== KP §9 — No-no list (STRICT) ==
${sec.noNoList || ''}

== Output format (STRICT JSON) ==

{
  "title": "Short imaginative or topic-direct title",
  "body": "## Title\\n\\nFirst paragraph...\\n\\nSecond paragraph...\\n\\n...",
  "topicNotes": "1-line internal note on the topic chosen"
}

== Body format ==
- Markdown. Open with "## " + title. Each paragraph separated by single blank line.
- ${band.words['realistic-fiction'][0]}-${band.words['realistic-fiction'][1]} words for realistic-fiction; ${band.words.informational[0]}-${band.words.informational[1]} words for informational.
- Use **bold** sparingly for Tier-3 vocabulary (informational only).
- DO NOT include images, HTML tags, or inline paragraph numbers.

== Strict-pass requirements ==
- §9 violations are STRICT — no death, romance, divorce, drugs, religion-as-theology, politics, violence, bullying-as-plot, mental-illness, disability-as-deficit, brand names, or current real public figures.
- §6 generator naming rule: protagonist's name should NOT match the obvious cultural-fit plot.
- Sibling conflict OK if resolved in-passage. Weather events OK if no character is hurt.

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildPassageUser(brief) {
  const genreLabel = brief.genre === 'realistic-fiction' ? 'Realistic fiction' : 'Informational';
  const protagonistLine = brief.protagonistName
    ? `Protagonist: ${brief.protagonistName} (${brief.protagonistDemographic || 'unspecified'})`
    : `Protagonist: demographically unmarked (no named protagonist)`;
  return `Generate ONE passage.

Genre: ${genreLabel}
Topic: ${brief.topic}
Setting: ${brief.setting || '(your choice — pick a Texas city or specific elsewhere)'}
${protagonistLine}

Match KP §2 word-count band for this genre, KP §8 readability target, and obey ALL §6/§7/§9 rules. Return strict JSON.`;
}

function buildQuestionsSystem(grade) {
  const earlyReader = ['k', '1', '2'].includes(String(grade).toLowerCase());
  const earlyReaderRules = earlyReader ? `

For grades K/1/2: stick to MAIN IDEA, KEY DETAIL, and SIMPLE SEQUENCE ("what happened first?"). Skip inference and author-purpose — too abstract. Question stems and answer choices use ≤8 words each. Vocabulary stays at early-reader level.
` : '';
  return `You write reading-comprehension multiple-choice questions for a Texas STAAR grade-${grade} practice app, given a passage. STAAR grade-${grade} reading questions test: main idea, key detail, vocabulary-in-context, inference, and author's purpose. Difficulty should match grade-${grade} STAAR released items (more nuance / longer-passage evidence at higher grades).${earlyReaderRules}

Output STRICT JSON:

{
  "questions": [
    {
      "stem": "Question text",
      "choices": ["A choice", "B choice", "C choice", "D choice"],
      "correctIndex": 2,
      "explanation": "Brief: cite specific evidence in the passage. 1-2 sentences.",
      "questionType": "main-idea | key-detail | vocabulary | inference | author-purpose"
    }
  ]
}

Rules (LOCKED):
- Exactly 5 questions per passage.
- Mix question types — at least 3 distinct types across the 5.
- Exactly 4 choices each, one correct.
- Distractors plausible but clearly wrong on careful reading of the passage.
- Question must be answerable from the passage only — no outside knowledge.
- For vocabulary questions, name the word clearly: "What does the word ___ mean as it is used in paragraph N?"
- Explanation cites SPECIFIC passage evidence (e.g. "paragraph 3, the sentence about...").
- NO §9 landmines (no death, no current real public figures, etc.).

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildQuestionsUser(passage) {
  return `Generate 5 reading-comprehension questions for the passage below.

Title: ${passage.title}

Passage:
${passage.body}

Return strict JSON.`;
}

function nowIso() { return new Date().toISOString(); }
function shortId() { return crypto.randomBytes(6).toString('hex'); }
function ensureOutputDir() { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); }

async function processBrief(brief, opts, apiKey) {
  const grade = String(brief.grade || '3');
  const band = GRADE_BANDS[grade] || GRADE_BANDS['3'];
  console.log(`\n=== ${brief.id} (g${grade} · ${brief.genre}) ===`);
  console.log(`topic: ${brief.topic.slice(0, 80)}${brief.topic.length > 80 ? '…' : ''}`);

  // Stage 1: passage
  console.log('  ⏳ generating passage…');
  const pSys = buildPassageSystem(grade);
  const pUser = buildPassageUser(brief);
  let passageRaw;
  try {
    const resp = await callOpenAI(pSys, pUser, apiKey, { temperature: 0.7, max_tokens: 1600 });
    passageRaw = resp.choices[0].message.content;
  } catch (err) {
    console.error(`  ✗ passage gen failed: ${err.message.slice(0, 120)}`);
    return { ok: false, brief, stage: 'passage', error: err.message };
  }
  let passageJson;
  try { passageJson = JSON.parse(passageRaw); }
  catch (err) {
    console.error(`  ✗ passage non-JSON: ${err.message.slice(0, 80)}`);
    return { ok: false, brief, stage: 'passage-parse', error: err.message };
  }
  const title = String(passageJson.title || '').trim();
  const body = String(passageJson.body || '').trim();
  if (!title || !body) {
    console.error('  ✗ passage missing title or body');
    return { ok: false, brief, stage: 'passage-empty' };
  }
  const report = getReadabilityReport(body);
  console.log(`  ✓ passage: "${title}" — ${report.wordCount}w, FK=${report.fkGrade.toFixed(1)}, lex≈${report.lexileEstimate}`);

  // Light validation — bands per grade
  const wordRange = band.words[brief.genre] || band.words['realistic-fiction'];
  if (report.wordCount < wordRange[0] || report.wordCount > wordRange[1]) {
    console.warn(`  ⚠ word-count ${report.wordCount} outside grade-${grade} target ${wordRange[0]}-${wordRange[1]} (proceeding anyway)`);
  }
  if (report.fkGrade < band.fk[0] - 1 || report.fkGrade > band.fk[1] + 2) {
    console.warn(`  ⚠ FK grade ${report.fkGrade.toFixed(1)} outside grade-${grade} target ${band.fk[0]}-${band.fk[1]} (proceeding anyway)`);
  }

  // Stage 2: questions
  console.log('  ⏳ generating 5 questions…');
  const qSys = buildQuestionsSystem(grade);
  const qUser = buildQuestionsUser({ title, body });
  let questionsRaw;
  try {
    const resp = await callOpenAI(qSys, qUser, apiKey, { temperature: 0.6, max_tokens: 2400 });
    questionsRaw = resp.choices[0].message.content;
  } catch (err) {
    console.error(`  ✗ questions gen failed: ${err.message.slice(0, 120)}`);
    return { ok: false, brief, stage: 'questions', error: err.message, passage: { title, body } };
  }
  let questionsJson;
  try { questionsJson = JSON.parse(questionsRaw); }
  catch (err) {
    console.error(`  ✗ questions non-JSON: ${err.message.slice(0, 80)}`);
    return { ok: false, brief, stage: 'questions-parse', error: err.message };
  }
  const qs = Array.isArray(questionsJson.questions) ? questionsJson.questions : [];
  if (qs.length < 4) {
    console.error(`  ✗ only ${qs.length} questions returned (need 4-5)`);
    return { ok: false, brief, stage: 'questions-short' };
  }
  // Schema validate each
  const validQs = [];
  for (const q of qs.slice(0, 5)) {
    if (!q || typeof q.stem !== 'string' || !Array.isArray(q.choices) || q.choices.length !== 4) continue;
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) continue;
    if (typeof q.explanation !== 'string') continue;
    validQs.push(q);
  }
  if (validQs.length < 4) {
    console.error(`  ✗ only ${validQs.length} schema-valid questions`);
    return { ok: false, brief, stage: 'questions-invalid' };
  }
  console.log(`  ✓ ${validQs.length} valid questions generated`);
  validQs.forEach((q, i) => {
    console.log(`     ${i + 1}. [${q.questionType || '?'}] ${q.stem.slice(0, 80)}…`);
  });

  // Build the records
  const passageId = `p_tx_${grade}_${brief.genre.replace('realistic-fiction', 'rf').replace('informational', 'info')}_${shortId()}`;
  const stateGradeGenre = `${STATE}_${grade}_${brief.genre}`;
  const passageRow = {
    passageId,
    state: STATE,
    grade,
    genre: brief.genre,
    stateGradeGenre,
    title,
    body,
    topic: brief.topic,
    topicNotes: String(passageJson.topicNotes || '').slice(0, 200),
    setting: brief.setting,
    protagonistName: brief.protagonistName,
    protagonistDemographic: brief.protagonistDemographic || 'unmarked',
    wordCount: report.wordCount,
    paragraphCount: report.paragraphCount,
    fkGrade: report.fkGrade,
    lexileEstimate: report.lexileEstimate,
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'reading-openai-v1',
    _kpVersion: loadKP().version || 'unknown',
    _briefId: brief.id
  };

  const poolKey = `${STATE}#${grade}#reading#${passageId}`;
  const questionRows = validQs.map((q, idx) => ({
    poolKey,
    contentId: `q_${shortId()}_${idx}`,
    state: STATE,
    grade,
    subject: 'reading',
    type: 'multiple_choice',
    questionType: q.questionType || 'unknown',
    question: q.stem,
    choices: q.choices,
    correctIndex: q.correctIndex,
    answer: q.choices[q.correctIndex],
    explanation: q.explanation,
    passageId,
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'reading-openai-v1',
    _briefId: brief.id
  }));

  return { ok: true, brief, passageRow, questionRows };
}

async function persist(passageRow, questionRows) {
  const { ddb, PutCommand } = getDdb();
  await ddb.send(new PutCommand({ TableName: PASSAGES_TABLE, Item: passageRow }));
  for (const q of questionRows) {
    await ddb.send(new PutCommand({ TableName: POOL_TABLE, Item: q }));
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('OPENAI_API_KEY not set'); process.exit(1); }

  let briefs = ALL_BRIEFS.slice();
  if (opts.briefId) briefs = briefs.filter(b => b.id === opts.briefId);
  if (opts.grade != null) briefs = briefs.filter(b => String(b.grade).toLowerCase() === opts.grade);
  if (!briefs.length) {
    console.error(`No briefs matched --brief-id=${opts.briefId || '(unset)'} --grade=${opts.grade ?? '(unset)'}`);
    process.exit(1);
  }

  // Idempotency: skip briefs whose ID is already in staar-passages
  // (so re-runs don't double-write the same content).
  if (!opts.dryRun) {
    try {
      const { ddb } = getDdb();
      const lib = require('@aws-sdk/lib-dynamodb');
      // Scan once with FilterExpression on _briefId IN (...). For our
      // brief counts (<60 IDs) the scan is cheap.
      const briefIdSet = new Set(briefs.map(b => b.id));
      const scanned = [];
      let last;
      do {
        const r = await ddb.send(new lib.ScanCommand({
          TableName: PASSAGES_TABLE,
          FilterExpression: 'attribute_exists(#bid)',
          ExpressionAttributeNames: { '#bid': '_briefId' },
          ProjectionExpression: '#bid',
          ExclusiveStartKey: last
        }));
        for (const it of (r.Items || [])) if (it._briefId) scanned.push(it._briefId);
        last = r.LastEvaluatedKey;
      } while (last);
      const alreadyRun = new Set(scanned.filter(id => briefIdSet.has(id)));
      if (alreadyRun.size > 0) {
        console.log(`[idempotency] ${alreadyRun.size} brief(s) already in DDB, skipping: ${[...alreadyRun].join(', ')}`);
        briefs = briefs.filter(b => !alreadyRun.has(b.id));
      }
      if (briefs.length === 0) {
        console.log('[idempotency] All requested briefs already exist. Nothing to do.');
        return;
      }
    } catch (err) {
      console.warn('[idempotency] check failed (proceeding anyway):', err.message);
    }
  }

  ensureOutputDir();
  const startedAt = nowIso();
  const runId = startedAt.replace(/[:.]/g, '-');
  console.log(`[reading-openai] runId=${runId} mode=${opts.dryRun ? 'dry-run' : 'WRITE'} briefs=${briefs.length}`);

  const results = [];
  for (const brief of briefs) {
    const r = await processBrief(brief, opts, apiKey);
    results.push(r);
    if (r.ok && !opts.dryRun) {
      try {
        await persist(r.passageRow, r.questionRows);
        console.log(`  ✓ persisted: passage ${r.passageRow.passageId} + ${r.questionRows.length} questions`);
      } catch (err) {
        console.error(`  ✗ persist failed: ${err.message.slice(0, 200)}`);
        r.persistError = err.message;
      }
    }
  }

  const ok = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Briefs attempted: ${results.length}`);
  console.log(`Passed: ${ok.length}`);
  console.log(`Failed: ${failed.length}`);
  for (const r of failed) {
    console.log(`  FAIL ${r.brief.id} @${r.stage}: ${(r.error || '').slice(0, 80)}`);
  }
  console.log(`Mode: ${opts.dryRun ? 'DRY-RUN (no DDB writes)' : 'WRITE (persisted)'}`);

  const outPath = path.join(OUTPUT_DIR, `reading-openai-${runId}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    runId, startedAt, mode: opts.dryRun ? 'dry-run' : 'write',
    briefsAttempted: results.length, passed: ok.length, failed: failed.length,
    results
  }, null, 2));
  console.log(`Output: ${outPath}`);

  process.exit(ok.length === results.length ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
