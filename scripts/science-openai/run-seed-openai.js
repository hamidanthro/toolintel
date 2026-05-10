#!/usr/bin/env node
/**
 * Texas STAAR Grade 8 science seed batch — OpenAI-only pipeline.
 *
 * Mirrors scripts/social-studies/run-seed-openai.js (which itself
 * mirrors the reading pipeline). Generates a "scenario" stimulus +
 * 5 cluster questions per brief using gpt-4o for both stages.
 *
 * The Phase E-J Claude pipeline at scripts/science/ is the
 * cross-vendor verifier+judge gold-standard path; this OpenAI fork
 * is the "ship now" path while Anthropic billing is being topped up.
 * Quality bar: lower than Claude verifier+judge but acceptable v1
 * for a STAAR-tested grade currently sitting at 0 content.
 *
 * Targets TEKS §112.28 (Grade 8): Matter & Energy, Force/Motion/
 * Energy, Earth & Space, Organisms & Environments. Each brief maps
 * to ONE Readiness or Supporting SE per CLAUDE.md §38 KP.
 *
 * Usage:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     OPENAI_API_KEY=$(aws secretsmanager get-secret-value \
 *       --secret-id staar-tutor/openai-api-key \
 *       --region us-east-1 --query SecretString --output text) \
 *     node scripts/science-openai/run-seed-openai.js [--brief-id <id>] [--write]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE = 'texas';
const SUBJECT = 'science';
const MODEL = 'gpt-4o';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 90000;

const PASSAGES_TABLE = 'staar-passages';
const POOL_TABLE = 'staar-content-pool';
const OUTPUT_DIR = path.resolve(__dirname, 'output');

// Texas science briefs by grade. Each brief maps to ONE TEKS SE
// (Readiness or Supporting where the SE is tagged in the KP).
// Grade 8 (already shipped Phase R round 1) + grades 3, 4, 6, 7
// (this round). Grade 5 has 18 scenarios already (Phase J + Phase R)
// and isn't expanded here.
const BRIEFS = [
  // ===========================================================
  // ----- Kindergarten — practice-only -----
  // ===========================================================
  { id: 'gks-water-ice-melt', grade: 'k', strand: 'Matter & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid puts an ice cube in a cup on the kitchen counter; after a while the ice is gone and there is water in the cup; the question asks the kid what happened to the ice' },
  { id: 'gks-magnet-fridge', grade: 'k', strand: 'Matter & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid sticks a magnet on the fridge and on a wood door; the magnet sticks to the fridge but not the door; the question asks the kid which the magnet sticks to' },
  { id: 'gks-shadow-sun', grade: 'k', strand: 'Earth & Space', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: "on a sunny day a kid sees their own shadow on the sidewalk; in the shade there is no shadow; the question asks the kid what they need to make a shadow" },
  { id: 'gks-day-night-sky', grade: 'k', strand: 'Earth & Space', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: 'a picture of a daytime sky with the Sun and a nighttime sky with the Moon and stars; the question asks the kid what we see in the sky during the day' },
  { id: 'gks-living-vs-not-living', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: 'a list of four things — a dog, a rock, a tree, a toy car; the question asks the kid which two are living things' },
  { id: 'gks-baby-animal-grown', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: 'a picture of a kitten and a grown cat side by side; the question asks the kid which one is the baby and what it will grow up to be' },
  { id: 'gks-plant-needs-water', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid waters one plant every day and forgets to water another; the watered plant is green and tall; the not-watered plant is brown; the question asks what plants need to grow' },
  { id: 'gks-windy-day-leaves', grade: 'k', strand: 'Earth & Space', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: 'a kid watches leaves blow across the yard on a very windy day; nothing else moves the leaves; the question asks the kid what is moving the leaves' },
  { id: 'gks-bird-feeder-watch', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid puts seeds in a bird feeder; in the morning birds are eating the seeds; the question asks the kid why the birds came to the feeder' },
  { id: 'gks-loud-vs-quiet-sound', grade: 'k', strand: 'Force, Motion & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid taps a drum softly and then taps it hard; the soft tap makes a quiet sound, the hard tap makes a loud sound; the question asks why the drum sounded different' },

  // ===========================================================
  // ----- Grade 1 — practice-only -----
  // ===========================================================
  { id: 'g1s-five-senses', grade: '1', strand: 'Organisms & Environments', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: 'a kid examines an apple — they look at it, smell it, touch it, hear the crunch, taste it; the question asks the kid which sense they use to find out an apple is red' },
  { id: 'g1s-ramp-roll-faster', grade: '1', strand: 'Force, Motion & Energy', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'a kid lets a ball roll down a low ramp and then a steep ramp; the ball rolls faster on the steep ramp; the question asks what made the ball roll faster' },
  { id: 'g1s-bug-rock-find', grade: '1', strand: 'Organisms & Environments', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'a kid lifts a small rock in the yard and finds bugs underneath; the question asks why the bugs live under the rock' },
  { id: 'g1s-rain-puddle-evaporate', grade: '1', strand: 'Earth & Space', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'after a Texas rainstorm a kid sees puddles on the sidewalk; by afternoon the sun has dried the puddles up; the question asks the kid where the puddle water went' },
  { id: 'g1s-flashlight-dark', grade: '1', strand: 'Force, Motion & Energy', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'a kid turns on a flashlight in a dark room and shines it on the wall; a bright spot appears; the question asks what the flashlight makes' },
  { id: 'g1s-seed-to-plant', grade: '1', strand: 'Organisms & Environments', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'a kid plants a bean seed in a cup of soil and waters it; after a week a small green sprout appears; the question asks what the seed grew into' },
  { id: 'g1s-soft-vs-hard', grade: '1', strand: 'Matter & Energy', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'a kid sorts four objects — a pillow, a brick, a sponge, a wood block — into soft and hard piles; the question asks which property they used to sort' },
  { id: 'g1s-frog-pond-tadpole', grade: '1', strand: 'Organisms & Environments', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: 'a picture series shows a tadpole, then a tadpole with back legs, then a tiny frog with a tail, then a grown frog; the question asks the kid what the tadpole grows into' },
  { id: 'g1s-pull-vs-push', grade: '1', strand: 'Force, Motion & Energy', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'a kid pulls a wagon and then pushes it; both ways move the wagon; the question asks what kind of force a pull and a push are' },
  { id: 'g1s-day-night-routine', grade: '1', strand: 'Earth & Space', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: "a kid's day shows breakfast in the morning, lunch in the day, and bedtime when it is dark; the question asks the kid what part of the day comes after the Sun goes down" },

  // ----- K v2 — six more briefs, doubling K NO-REPEAT cycle -----
  { id: 'gks-warm-vs-cold', grade: 'k', strand: 'Matter & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid touches a cup of hot cocoa and a glass of cold water; the question asks the kid which one is warm and which is cold and how their hands tell them' },
  { id: 'gks-float-sink', grade: 'k', strand: 'Matter & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid puts a leaf and a small rock in a bowl of water; the leaf floats on top, the rock sinks to the bottom; the question asks the kid which one floated and which sank' },
  { id: 'gks-fast-vs-slow', grade: 'k', strand: 'Force, Motion & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid pushes a toy car softly and it goes slow; then pushes it hard and it goes fast; the question asks why the car went faster the second time' },
  { id: 'gks-rain-clouds', grade: 'k', strand: 'Earth & Space', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: "a picture shows a sunny sky and another picture shows a sky with big gray clouds and rain falling; the question asks the kid which sky brings rain" },
  { id: 'gks-pet-needs-food', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: 'a kid takes care of a puppy — gives it food, water, and a bed; the question asks the kid which thing the puppy needs to eat to grow' },
  { id: 'gks-leaves-fall-color', grade: 'k', strand: 'Earth & Space', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: "a Texas backyard has green leaves on trees in summer and orange and red leaves on the ground in fall; the question asks the kid what season makes the leaves change color" },

  // ----- K v3 — six more briefs -----
  { id: 'gks-magnet-paperclips', grade: 'k', strand: 'Force, Motion & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid waves a magnet over a pile of paper clips and rubber bands; the paper clips jump up and stick to the magnet, the rubber bands do not move; the question asks the kid which one stuck and why' },
  { id: 'gks-rolling-vs-sliding', grade: 'k', strand: 'Force, Motion & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid pushes a round ball and a flat block across the same floor with the same push; the ball rolls far, the block slides only a little; the question asks the kid why the ball went farther' },
  { id: 'gks-dry-vs-wet', grade: 'k', strand: 'Matter & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid drops water on a paper towel and on a plastic plate; the paper towel soaks up the water, the plastic does not; the question asks the kid which one took the water in' },
  { id: 'gks-tx-fireflies-night', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: "a Texas summer evening backyard has fireflies blinking yellow lights as it gets dark; the question asks the kid what part of the day fireflies show their lights" },
  { id: 'gks-water-running-tap', grade: 'k', strand: 'Earth & Space', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid turns on the tap and water flows out; they turn the tap off and the water stops; the question asks the kid what they need to do to make the water flow' },
  { id: 'gks-bird-needs-water-too', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: 'a kid sees a robin in the yard drinking from a small bird bath after a hot Texas afternoon; the question asks the kid what living things need every day' },

  // ----- K v4 — eight more briefs -----
  { id: 'gks-bouncing-ball', grade: 'k', strand: 'Force, Motion & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid bounces a rubber ball on the floor and on the carpet; the ball bounces high on the floor and low on the carpet; the question asks the kid which surface made the ball bounce higher' },
  { id: 'gks-paper-fold-airplane', grade: 'k', strand: 'Force, Motion & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid folds a paper airplane and throws it gently; the plane glides across the room; when crumpled into a ball, it falls straight down; the question asks the kid which shape lets the paper fly farther' },
  { id: 'gks-sun-warms-rock', grade: 'k', strand: 'Earth & Space', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid touches a rock that has been sitting in the sun and a rock that has been in the shade; the sunny rock feels warm, the shady rock feels cool; the question asks the kid what made the rock warm' },
  { id: 'gks-tx-roadrunner-bird', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: 'a Texas roadrunner is a bird that runs on the ground instead of flying high; it has long legs that help it run fast through the dry land; the question asks the kid how the roadrunner moves around' },
  { id: 'gks-hat-blocks-sun', grade: 'k', strand: 'Earth & Space', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid wears a wide-brim sun hat outside in Texas; the hat puts a shadow on their face and the sun does not reach their eyes; the question asks the kid what the hat is doing for them' },
  { id: 'gks-balloon-pop', grade: 'k', strand: 'Matter & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid blows up a balloon and a sharp pin pops it; the balloon makes a loud sound and the air rushes out; the question asks the kid where the air went after the pop' },
  { id: 'gks-tx-deer-eat-grass', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: 'a Texas deer family eats grass and plants in a field at sunset; the deer chew their food slowly; the question asks the kid what food the deer eat to stay alive' },
  { id: 'gks-clouds-shapes', grade: 'k', strand: 'Earth & Space', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: 'a kid lays in the grass and watches white fluffy clouds float across the blue Texas sky; one cloud looks like a bunny, another like a heart; the question asks the kid where clouds are' },

  // ----- K v5 — six more briefs (deepening K daughter floor) -----
  { id: 'gks-tx-prickly-pear-fruit', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: "a Texas prickly pear cactus has sharp spines all over its flat green pads, plus bright red fruit on top; the question asks the kid why the cactus has the sharp spines" },
  { id: 'gks-fan-blows-wind', grade: 'k', strand: 'Force, Motion & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid points a small fan at a paper kite and the kite flies up; when the fan turns off, the kite drops; the question asks the kid what the fan is making that lifts the kite' },
  { id: 'gks-snowflake-pattern', grade: 'k', strand: 'Earth & Space', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: "after a rare snowy day in North Texas, a kid catches a snowflake on their dark coat and sees it has six points like a tiny star; the question asks the kid what shape every snowflake has" },
  { id: 'gks-tx-bluebonnet-spring', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'described_diagram',
    topic: "a Texas roadside in spring has thousands of bluebonnets bringing the field to life; in winter the same field had only brown grass; the question asks the kid what season the bluebonnets bloom" },
  { id: 'gks-fish-need-water', grade: 'k', strand: 'Organisms & Environments', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a class fish swims happily in a tank of water; the question asks the kid what the fish needs to keep living' },
  { id: 'gks-light-switch-on-off', grade: 'k', strand: 'Force, Motion & Energy', se: 'K-observe',
    scenarioType: 'experiment',
    topic: 'a kid flips a light switch up and the room becomes bright; flips it down and the room becomes dark; the question asks the kid what the switch is doing to the light' },

  // ----- G1 v2 — six more briefs -----
  { id: 'g1s-water-states-ice-cube', grade: '1', strand: 'Matter & Energy', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: "a kid takes an ice cube out of the freezer and lets it sit on a plate; after lunch the ice is gone and there is water on the plate; the question asks the kid what kind of change made the ice into water" },
  { id: 'g1s-shadow-changes-day', grade: '1', strand: 'Earth & Space', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: "a kid traces their shadow on the playground in the morning, at noon, and in the afternoon; each tracing is in a different spot and a different size; the question asks the kid why the shadow moved" },
  { id: 'g1s-tx-cardinal-color', grade: '1', strand: 'Organisms & Environments', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: 'a Texas backyard has a bright red cardinal at a bird feeder and a brown female cardinal nearby; the question asks the kid how the bright red feathers help the male cardinal' },
  { id: 'g1s-cup-stack-knock', grade: '1', strand: 'Force, Motion & Energy', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: "a kid stacks ten paper cups in a tower; a soft tap on the bottom cup makes the tower wiggle, a hard push makes the tower fall; the question asks the kid what kind of force made the cups fall" },
  { id: 'g1s-tx-prairie-grass', grade: '1', strand: 'Organisms & Environments', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: "a kid walks through a Texas prairie and sees tall grass everywhere — some is green, some is brown and dry; the question asks the kid what plants need to stay green" },
  { id: 'g1s-rocks-sort-by-color', grade: '1', strand: 'Earth & Space', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'a kid finds five rocks on a Texas creek bank — gray, white, red, brown, and black — and sorts them by color; the question asks the kid which property they used to sort the rocks' },

  // ----- G1 v3 — six more briefs -----
  { id: 'g1s-rubber-band-stretch', grade: '1', strand: 'Force, Motion & Energy', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'a kid stretches a rubber band between two fingers and lets it go; the rubber band snaps back to its starting size; the question asks the kid what happens when something elastic is stretched and released' },
  { id: 'g1s-tx-pecan-tree-seasons', grade: '1', strand: 'Organisms & Environments', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: "a Texas pecan tree shows green leaves in summer, brown leaves in fall, bare branches in winter, and tiny new leaves in spring; the question asks the kid what season the leaves come back" },
  { id: 'g1s-mixing-colors-paint', grade: '1', strand: 'Matter & Energy', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'a kid mixes red paint and blue paint together on a paper plate; the new color is purple; the question asks the kid what happens to two colors of paint when they are mixed' },
  { id: 'g1s-tx-cricket-night-sound', grade: '1', strand: 'Organisms & Environments', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: 'on a warm Texas summer night a kid hears chirping crickets in the grass; in the morning the crickets are quiet; the question asks the kid when crickets make their chirp sound' },
  { id: 'g1s-soil-rocks-leaves', grade: '1', strand: 'Earth & Space', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: "a kid digs a small hole in a Texas backyard and finds soil mixed with little rocks, dead leaves, and a tiny worm; the question asks the kid what kinds of things the soil is made of" },
  { id: 'g1s-tx-summer-thunderstorm', grade: '1', strand: 'Earth & Space', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: 'a hot Texas summer afternoon turns into a thunderstorm — big dark clouds gather, lightning flashes, thunder booms, then heavy rain falls and cools the air; the question asks the kid what often comes after lightning' },

  // ----- G1 v4 — eight more briefs -----
  { id: 'g1s-rough-vs-smooth-friction', grade: '1', strand: 'Force, Motion & Energy', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'a kid slides a small block across smooth tile and across a rough rug; the block slides far on the tile and stops quickly on the rug; the question asks the kid which surface slowed the block down more' },
  { id: 'g1s-tx-fall-leaves-color', grade: '1', strand: 'Earth & Space', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: 'in late fall a Texas oak tree changes from green leaves to brown and red leaves before the leaves drop; the question asks the kid what season makes the leaves change color' },
  { id: 'g1s-tx-honeybee-pollination', grade: '1', strand: 'Organisms & Environments', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: "a honeybee lands on a Texas wildflower, picks up pollen on its fuzzy legs, and flies to another flower nearby; the bee helps the second flower grow seeds; the question asks the kid how bees help flowers" },
  { id: 'g1s-evaporation-puddle', grade: '1', strand: 'Earth & Space', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'after a Texas spring rain a kid sees puddles on the driveway in the morning; by afternoon the puddles are gone and the sidewalk is dry; the question asks the kid where the puddle water went' },
  { id: 'g1s-glass-vs-plastic-shatter', grade: '1', strand: 'Matter & Energy', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'a kid drops two empty cups — one made of plastic, one made of glass — onto the floor; the plastic cup bounces but the glass cup breaks into pieces; the question asks the kid what property makes plastic safer to drop' },
  { id: 'g1s-tx-cactus-spines', grade: '1', strand: 'Organisms & Environments', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: 'a prickly pear cactus in Texas has many sharp spines covering its flat green pads; the question asks the kid how the spines help protect the cactus' },
  { id: 'g1s-snow-melt-cup', grade: '1', strand: 'Matter & Energy', se: 'G1-observe',
    scenarioType: 'experiment',
    topic: 'on a rare Texas snowy morning, a kid scoops some snow into a cup and brings it inside; an hour later the snow is gone and there is water in the cup; the question asks the kid what happened to the snow' },
  { id: 'g1s-tx-coyote-howl-night', grade: '1', strand: 'Force, Motion & Energy', se: 'G1-observe',
    scenarioType: 'described_diagram',
    topic: 'on a Texas night a kid hears coyotes howling far away in the hills; the kid can hear the sound even though they cannot see the coyotes; the question asks the kid how sound travels from the coyote to their ears' },

  // ===========================================================
  // ----- Grade 2 — practice-only -----
  // ===========================================================
  { id: 'g2s-states-water-three', grade: '2', strand: 'Matter & Energy', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: 'a kid sees water in three forms in one day — ice in the freezer, water from the tap, steam from the kettle; the question asks the kid the three states of matter water can be in' },
  { id: 'g2s-pull-stronger-team', grade: '2', strand: 'Force, Motion & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: 'two kids play tug-of-war; the stronger kid pulls harder and the rope moves their way; the question asks the kid why the rope moves toward the stronger puller' },
  { id: 'g2s-shadow-time-of-day', grade: '2', strand: 'Earth & Space', se: 'G2-observe',
    scenarioType: 'data_analysis',
    topic: 'a kid measures their shadow at three times — short at noon, long in the morning and afternoon; the question asks why the shadow is shorter at noon' },
  { id: 'g2s-bird-beak-shape', grade: '2', strand: 'Organisms & Environments', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: 'a picture shows three Texas birds — hummingbird (long thin beak), hawk (sharp curved beak), duck (wide flat beak); the question asks the kid which beak is best for catching small fish' },
  { id: 'g2s-magnet-pulls-pushes', grade: '2', strand: 'Force, Motion & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: 'a kid holds two magnets together — one way they snap together, the other way they push apart; the question asks the kid what magnets can do besides stick to metal' },
  { id: 'g2s-rocks-small-pieces', grade: '2', strand: 'Earth & Space', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: 'a kid sees a big rock by a creek that has small bits of sand and pebbles around it; over time the rock got smaller; the question asks what makes a big rock turn into small bits' },
  { id: 'g2s-life-cycle-butterfly', grade: '2', strand: 'Organisms & Environments', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: 'a picture series shows the four stages of a butterfly: egg, caterpillar, chrysalis, butterfly; the question asks the kid which stage comes after the caterpillar' },
  { id: 'g2s-mixture-rice-beans', grade: '2', strand: 'Matter & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: 'a kid pours rice and dried beans together in a bowl and stirs; then they pick out the beans; the question asks the kid whether the rice and beans changed when mixed' },
  { id: 'g2s-pet-fish-needs', grade: '2', strand: 'Organisms & Environments', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: 'a class fish in a tank needs three things — water, food, and a clean tank; the question asks the kid what would happen if the fish ran out of food' },
  { id: 'g2s-sun-warms-things', grade: '2', strand: 'Earth & Space', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: 'a kid leaves two cups of water — one in the sunny window, one in the shade — for an hour; the cup in the sun feels warmer; the question asks why the sunny cup is warmer' },

  // ----- G2 v2 — six more briefs -----
  { id: 'g2s-melting-chocolate', grade: '2', strand: 'Matter & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: "a kid leaves a chocolate bar in a sunny car for thirty minutes; when they come back the bar is soft and runny; the question asks the kid what made the chocolate change shape" },
  { id: 'g2s-balloon-rub-static', grade: '2', strand: 'Force, Motion & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: 'a kid rubs a balloon on their hair and then holds it near small bits of paper; the paper jumps up and sticks to the balloon; the question asks the kid what made the paper stick' },
  { id: 'g2s-tx-armadillo-shell', grade: '2', strand: 'Organisms & Environments', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: 'a Texas armadillo has a hard shell on its back and soft skin underneath; the question asks the kid how the hard shell helps the armadillo stay safe' },
  { id: 'g2s-water-cycle-simple', grade: '2', strand: 'Earth & Space', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: "a picture series shows water in a Texas pond, water rising as steam in the sunshine, clouds forming, and rain falling back down; the question asks the kid the order of what happens to the water" },
  { id: 'g2s-pulley-bucket-up', grade: '2', strand: 'Force, Motion & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: "a kid uses a rope over a tree branch to pull a bucket up; pulling down on the rope lifts the bucket up; the question asks the kid what kind of simple machine the rope-and-branch is" },
  { id: 'g2s-tx-bluebonnet-bee', grade: '2', strand: 'Organisms & Environments', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: "a Texas field of bluebonnets in spring has bees flying from flower to flower; the bees take pollen with them; the question asks the kid what the bees help the flowers do" },

  // ----- G2 v3 — six more briefs -----
  { id: 'g2s-warm-cup-cools', grade: '2', strand: 'Matter & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: "a kid sets a hot cup of cocoa on the kitchen table; thirty minutes later the cocoa is only a little warm; the question asks the kid where the heat went" },
  { id: 'g2s-tx-armadillo-burrow', grade: '2', strand: 'Organisms & Environments', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: 'a Texas armadillo digs a long tunnel under the ground to make a home and to hide from coyotes; the question asks the kid how the burrow helps the armadillo survive' },
  { id: 'g2s-balance-scale-rock', grade: '2', strand: 'Matter & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: 'a kid puts a small rock on one side of a balance scale and a big rock on the other; the side with the big rock goes down; the question asks the kid which rock has more mass' },
  { id: 'g2s-tx-rain-soak-soil', grade: '2', strand: 'Earth & Space', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: "a kid pours a cup of water on dry Texas soil; the water soaks in and the dirt turns dark; the question asks the kid what happened to the water" },
  { id: 'g2s-tx-rabbit-fast-run', grade: '2', strand: 'Force, Motion & Energy', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: 'a Texas jackrabbit can run very fast in a zigzag pattern; the zigzag helps the rabbit get away when a coyote chases it; the question asks the kid how the zigzag helps the rabbit survive' },
  { id: 'g2s-melting-ice-cream', grade: '2', strand: 'Matter & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: "a kid leaves an ice-cream cone in the sun and goes to play; when they come back the ice cream is dripping down the cone; the question asks the kid what changed the ice cream" },

  // ----- G2 v4 — eight more briefs -----
  { id: 'g2s-tx-deer-hide-color', grade: '2', strand: 'Organisms & Environments', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: 'a Texas white-tailed deer has brown fur that looks just like dry grass and tree bark; when the deer stands still in the woods, it is hard to see; the question asks the kid how the brown fur helps the deer stay safe' },
  { id: 'g2s-magnet-strength-distance', grade: '2', strand: 'Force, Motion & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: 'a kid moves a magnet close to a paper clip and the paper clip jumps to the magnet; when the magnet is far away nothing happens; the question asks the kid how distance changes the way the magnet pulls' },
  { id: 'g2s-tx-mockingbird-mimic', grade: '2', strand: 'Organisms & Environments', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: 'the Texas mockingbird sings songs it heard from cardinals, robins, and even car alarms; the question asks the kid how mockingbirds learn the songs they sing' },
  { id: 'g2s-thermometer-hot-cold', grade: '2', strand: 'Matter & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: 'a kid puts a thermometer in a glass of hot water and watches the red line go up; in cold water the line goes down; the question asks the kid what the thermometer is measuring' },
  { id: 'g2s-tx-rain-grass-grows', grade: '2', strand: 'Organisms & Environments', se: 'G2-observe',
    scenarioType: 'data_analysis',
    topic: 'after a wet Texas spring with lots of rain, the grass on the front lawn is tall and bright green; after a dry summer with no rain, the grass is short and brown; the question asks the kid what plants need to grow' },
  { id: 'g2s-bottle-roll-floor', grade: '2', strand: 'Force, Motion & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: 'a kid rolls a closed empty bottle on a smooth floor and watches it roll a long way; on a rug the bottle rolls only a little; the question asks the kid which surface let the bottle keep moving' },
  { id: 'g2s-water-paper-towel', grade: '2', strand: 'Matter & Energy', se: 'G2-observe',
    scenarioType: 'experiment',
    topic: 'a kid drops a paper towel into a small puddle of water on the kitchen counter; the paper towel turns dark and soft as it soaks the water up; the question asks the kid where the water went' },
  { id: 'g2s-tx-pond-tadpoles', grade: '2', strand: 'Organisms & Environments', se: 'G2-observe',
    scenarioType: 'described_diagram',
    topic: 'in a Texas pond a kid sees tiny black tadpoles wiggling in the water in spring; by summer the tadpoles have grown back legs and look more like frogs; the question asks the kid what the tadpoles are growing into' },

  // ===========================================================
  // ----- Grade 8 (TEKS §112.28) — STAAR-tested -----
  // (Original Phase R briefs, now tagged with grade field)
  // ===========================================================
  // ----- Matter & Energy -----
  { id: 'g8s-conservation-mass-photosynthesis', grade: '8', strand: 'Matter & Energy',
    se: '8.6E', scenarioType: 'experiment',
    topic: 'students measure the mass of a closed terrarium with plants over four weeks; the question asks the student to identify what happens to the total mass and why (atoms rearrange in photosynthesis, mass is conserved)' },

  // ----- Force, Motion & Energy -----
  { id: 'g8s-newton-second-law-cart', grade: '8', strand: 'Force, Motion & Energy',
    se: '8.7A', scenarioType: 'experiment',
    topic: 'students push a 2 kg cart, then a 4 kg cart, with the same applied force across a smooth lab floor; the question asks the student to calculate or compare acceleration using a = F/m' },
  { id: 'g8s-newton-three-laws-rocket', grade: '8', strand: 'Force, Motion & Energy',
    se: '8.7B', scenarioType: 'described_diagram',
    topic: 'a description of a model rocket launch — fuel ignites, exhaust shoots downward, rocket lifts upward; the question asks the student to identify which of Newtons three laws explains the motion' },
  { id: 'g8s-em-spectrum-waves', grade: '8', strand: 'Force, Motion & Energy',
    se: '8.8A', scenarioType: 'data_analysis',
    topic: 'a chart of four electromagnetic waves (radio, visible light, X-ray, gamma) with their wavelengths in scientific notation; the question asks the student to identify which has the highest frequency and why' },

  // ----- Earth & Space -----
  { id: 'g8s-hr-diagram-star-life', grade: '8', strand: 'Earth & Space',
    se: '8.9A', scenarioType: 'described_diagram',
    topic: 'a description of the Hertzsprung-Russell diagram showing main sequence, red giants, white dwarfs; the question asks the student to identify which life-cycle stage a Sun-like star is currently in and where it goes next' },
  { id: 'g8s-galaxy-types-milky-way', grade: '8', strand: 'Earth & Space',
    se: '8.9B', scenarioType: 'described_diagram',
    topic: 'a description of three galaxy types (spiral, elliptical, irregular) with their general shapes; the question asks the student to identify which type the Milky Way is and where the solar system sits within it' },
  { id: 'g8s-sun-hydrosphere-weather', grade: '8', strand: 'Earth & Space',
    se: '8.10A', scenarioType: 'experiment',
    topic: 'students model the water cycle in a sealed container with a heat lamp; the question asks the student to identify how the Sun, hydrosphere, and atmosphere together drive weather (energy transfer, evaporation, condensation)' },
  { id: 'g8s-global-atmospheric-circulation', grade: '8', strand: 'Earth & Space',
    se: '8.10B', scenarioType: 'data_analysis',
    topic: 'a global wind-pattern map showing trade winds, westerlies, and polar easterlies; the question asks the student to identify which pattern brings most weather across Texas and why' },
  { id: 'g8s-tropical-cyclones-formation', grade: '8', strand: 'Earth & Space',
    se: '8.10C', scenarioType: 'described_diagram',
    topic: 'a description of warm Gulf of Mexico water (over 80°F) meeting moist air over the ocean during late summer; the question asks the student to identify the conditions that allow a tropical cyclone to form and intensify' },

  // ----- Organisms & Environments -----
  { id: 'g8s-ecological-succession-fire', grade: '8', strand: 'Organisms & Environments',
    se: '8.12B', scenarioType: 'data_analysis',
    topic: 'a Texas Hill Country area three years after a wildfire — grasses, shrubs, then juniper and oak returning over time; the question asks the student to identify whether this is primary or secondary succession and why' },
  { id: 'g8s-biodiversity-ecosystem-stability', grade: '8', strand: 'Organisms & Environments',
    se: '8.12C', scenarioType: 'data_analysis',
    topic: 'a comparison of two Texas grassland plots — one with 12 native species, one monoculture invaded by a single grass; the question asks the student to identify which plot is more stable when drought hits and why' },
  { id: 'g8s-cell-organelles-function', grade: '8', strand: 'Organisms & Environments',
    se: '8.13A', scenarioType: 'described_diagram',
    topic: 'a description of an animal cell labeled with cell membrane, nucleus, ribosomes, cytoplasm, and mitochondria; the question asks the student to identify which organelle is responsible for converting glucose into usable energy (ATP)' },
  { id: 'g8s-genes-inherited-traits', grade: '8', strand: 'Organisms & Environments',
    se: '8.13B', scenarioType: 'described_diagram',
    topic: 'a description of a gene as a section of DNA on a chromosome that codes for a single trait; the question asks the student to identify which inherited trait (from a list including learned skills) genes can determine and which cannot' },
  { id: 'g8s-trait-variation-adaptation', grade: '8', strand: 'Organisms & Environments',
    se: '8.13C', scenarioType: 'data_analysis',
    topic: 'data showing a Texas snake population over 20 years where lighter-colored snakes survive better in a brighter habitat; the question asks the student to identify how trait variation leads to differential reproductive success over generations' },

  // ===========================================================
  // ----- Grade 3 (TEKS §112.5) — practice-only -----
  // ===========================================================
  { id: 'g3s-sink-float-density', grade: '3', strand: 'Matter & Energy', se: '3.6A', scenarioType: 'experiment',
    topic: 'students drop a wooden block, a steel washer, and a plastic spoon into a tub of water; the question asks the student to identify the physical property that decides which sinks and which floats' },
  { id: 'g3s-magnet-iron-objects', grade: '3', strand: 'Matter & Energy', se: '3.6A', scenarioType: 'described_diagram',
    topic: 'a description of a tray with an iron nail, a copper penny, a plastic button, and a wooden spoon; a magnet picks up only the iron nail; the question asks the student to identify which physical property the magnet was testing' },
  { id: 'g3s-states-of-matter-water', grade: '3', strand: 'Matter & Energy', se: '3.6B', scenarioType: 'described_diagram',
    topic: 'a description of an ice cube on a counter that melts to water and then evaporates; the question asks the student to identify the three states of matter shown and what changed' },
  { id: 'g3s-magnet-pull-paperclip', grade: '3', strand: 'Force, Motion & Energy', se: '3.7A', scenarioType: 'experiment',
    topic: 'a student holds a magnet over a paperclip on a desk; without touching, the paperclip jumps up; the question asks the student to identify the type of force at work' },
  { id: 'g3s-ramp-ball-rolling', grade: '3', strand: 'Force, Motion & Energy', se: '3.7A', scenarioType: 'experiment',
    topic: 'a student lets a ball roll down a wooden ramp; the question asks the student to identify the force that pulls the ball down' },
  { id: 'g3s-clap-sound-energy', grade: '3', strand: 'Force, Motion & Energy', se: '3.8A', scenarioType: 'described_diagram',
    topic: 'a description of a kid clapping in a quiet classroom; everyone hears the clap; the question asks the student to identify the type of energy that traveled to their ears' },
  { id: 'g3s-sun-earth-moon-orbit', grade: '3', strand: 'Earth & Space', se: '3.9A', scenarioType: 'described_diagram',
    topic: 'a description of a model with a Sun ball in the middle, an Earth ball orbiting the Sun, and a Moon ball orbiting Earth; the question asks the student to identify what the Moon orbits' },
  { id: 'g3s-planet-order-from-sun', grade: '3', strand: 'Earth & Space', se: '3.9B', scenarioType: 'described_diagram',
    topic: 'a list of the eight planets in order from the Sun (Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune); the question asks the student to identify which planet is third from the Sun' },
  { id: 'g3s-soil-from-rocks', grade: '3', strand: 'Earth & Space', se: '3.10B', scenarioType: 'described_diagram',
    topic: 'a description of a large rock by a creek where weathering has cracked it and small bits of sand have collected; the question asks the student to identify the natural process that turned rock into soil' },
  { id: 'g3s-bears-winter-sleep', grade: '3', strand: 'Organisms & Environments', se: '3.12A', scenarioType: 'described_diagram',
    topic: 'a description of a Texas black bear that eats berries all summer and sleeps through winter; the question asks the student to identify what causes the bear to sleep through winter' },
  { id: 'g3s-fossil-shell-history', grade: '3', strand: 'Organisms & Environments', se: '3.12D', scenarioType: 'described_diagram',
    topic: 'a description of a hiker in Central Texas who finds a spiral shell pressed into limestone far from any ocean; the question asks the student to identify what the fossil tells us about the area long ago' },
  { id: 'g3s-duck-webbed-feet', grade: '3', strand: 'Organisms & Environments', se: '3.13A', scenarioType: 'described_diagram',
    topic: 'a description of a duck swimming with wide webbed feet pushing water like paddles; the question asks the student to identify how the webbed feet help the duck survive' },

  // ----- G3 v2 — six more briefs -----
  { id: 'g3s-thermometer-temp', grade: '3', strand: 'Matter & Energy', se: '3.6B', scenarioType: 'experiment',
    topic: 'a student uses a thermometer to measure the temperature of three glasses of water — ice water, room-temperature water, and warm water; the question asks the student to identify which glass has the highest temperature and what the thermometer is measuring' },
  { id: 'g3s-light-mirror-reflect', grade: '3', strand: 'Force, Motion & Energy', se: '3.8A', scenarioType: 'experiment',
    topic: 'a student shines a flashlight at a mirror and sees the light bounce off and land on the wall; the question asks the student to identify what is happening when light hits the mirror' },
  { id: 'g3s-tx-storm-clouds', grade: '3', strand: 'Earth & Space', se: '3.10C', scenarioType: 'described_diagram',
    topic: 'a description of three Texas weather days — sunny with a few small clouds, mostly cloudy with no rain, dark gray clouds with thunder and rain; the question asks the student to identify which kind of cloud usually brings a thunderstorm' },
  { id: 'g3s-tx-monarch-migration', grade: '3', strand: 'Organisms & Environments', se: '3.12A', scenarioType: 'described_diagram',
    topic: 'a description of monarch butterflies that fly through Texas every fall on their way south to Mexico for winter; the question asks the student to identify why monarchs fly south as winter comes' },
  { id: 'g3s-roots-leaves-jobs', grade: '3', strand: 'Organisms & Environments', se: '3.13A', scenarioType: 'described_diagram',
    topic: "a Texas live oak tree has deep roots in the ground and many wide leaves; the question asks the student to identify what each part does — the job of the roots and the job of the leaves" },
  { id: 'g3s-tx-hill-country-soil', grade: '3', strand: 'Earth & Space', se: '3.10B', scenarioType: 'data_analysis',
    topic: 'a student compares two soil samples from Texas — sandy soil from the coastal plains and dark rich soil from the Hill Country; the question asks the student to identify which soil is better for growing crops and why' },

  // ----- G3 v3 — six more briefs -----
  { id: 'g3s-mass-vs-weight', grade: '3', strand: 'Matter & Energy', se: '3.6A', scenarioType: 'experiment',
    topic: 'a student weighs a baseball on a kitchen scale and reads the number; the question asks the student to identify whether the number tells how much matter the ball has or only how heavy it feels in their hand' },
  { id: 'g3s-flashlight-battery-energy', grade: '3', strand: 'Force, Motion & Energy', se: '3.8A', scenarioType: 'experiment',
    topic: 'a student turns on a flashlight; the bulb glows; when the batteries are taken out, the bulb does not glow even with the switch flipped; the question asks the student to identify where the energy for the light came from' },
  { id: 'g3s-tx-sun-rises-east', grade: '3', strand: 'Earth & Space', se: '3.9A', scenarioType: 'data_analysis',
    topic: "a student watches the sun rise over their Texas backyard for three days; each morning the sun comes up on the same side of the sky; the question asks the student to identify which direction the sun rises in" },
  { id: 'g3s-tx-coyote-food-chain', grade: '3', strand: 'Organisms & Environments', se: '3.13B', scenarioType: 'described_diagram',
    topic: 'a Texas Hill Country food chain shows grass eaten by a rabbit, the rabbit eaten by a coyote; the question asks the student to identify which one is the producer and which is the predator at the top' },
  { id: 'g3s-water-three-states-bottle', grade: '3', strand: 'Matter & Energy', se: '3.6B', scenarioType: 'experiment',
    topic: 'a student fills a closed plastic bottle halfway with water and puts it in the freezer; the next day the water inside is frozen solid; the question asks the student to identify what kind of change took place and whether mass was lost' },
  { id: 'g3s-tx-gulf-coast-erosion', grade: '3', strand: 'Earth & Space', se: '3.10B', scenarioType: 'described_diagram',
    topic: "a description of waves crashing on the Texas Gulf Coast year after year; the sand on the beach moves and the cliffs slowly get smaller; the question asks the student to identify the natural process that wears the land down over time" },

  // ----- G3 v4 — six more briefs -----
  { id: 'g3s-air-pressure-balloon', grade: '3', strand: 'Matter & Energy', se: '3.6A', scenarioType: 'experiment',
    topic: 'a student blows air into a balloon and ties it; the inflated balloon stays the same size when held still; the student is asked to identify what is inside the balloon and what is keeping the balloon stretched' },
  { id: 'g3s-tx-water-cycle-evapotranspiration', grade: '3', strand: 'Earth & Space', se: '3.10A', scenarioType: 'described_diagram',
    topic: 'a description of a Texas Hill Country morning where dew on the grass is gone by lunchtime and a tree releases water vapor through tiny leaf pores; the student is asked to identify both natural processes (evaporation from the dew, transpiration from the tree) that put water into the air' },
  { id: 'g3s-tx-pollinator-mason-bee', grade: '3', strand: 'Organisms & Environments', se: '3.13A', scenarioType: 'described_diagram',
    topic: 'a Texas mason bee crawls into a tube-shaped nest in a backyard hotel; while collecting pollen for its young, the bee carries pollen from flower to flower; the question asks the student to identify how this insect helps Texas plants reproduce' },
  { id: 'g3s-tx-storm-lightning-thunder', grade: '3', strand: 'Earth & Space', se: '3.10C', scenarioType: 'experiment',
    topic: 'during a Texas thunderstorm a student sees a flash of lightning and three seconds later hears thunder; on the next flash the wait is shorter; the question asks the student why we see the lightning before we hear the thunder' },
  { id: 'g3s-friction-shoes-floor', grade: '3', strand: 'Force, Motion & Energy', se: '3.7A', scenarioType: 'experiment',
    topic: 'a student wearing socks on a smooth wood floor slides easily; wearing rubber shoes on the same floor they cannot slide; the question asks the student to identify what makes the rubber shoe stop and the sock slide' },
  { id: 'g3s-tx-prairie-fire-recovery', grade: '3', strand: 'Organisms & Environments', se: '3.12A', scenarioType: 'data_analysis',
    topic: 'a Texas prairie three months after a small wildfire — first green grass shoots come up through the burned soil, then small wildflowers, then bushes after a year; the question asks the student to identify the order of recovery and why grass returns first' },

  // ===========================================================
  // ----- Grade 4 (TEKS §112.6) — practice-only -----
  // ===========================================================
  { id: 'g4s-mixture-iron-sand', grade: '4', strand: 'Matter & Energy', se: '4.6', scenarioType: 'experiment',
    topic: 'students mix iron filings with sand and try to separate them; the question asks the student to identify which physical property allows the iron to be separated' },
  { id: 'g4s-conservation-mass-dissolve', grade: '4', strand: 'Matter & Energy', se: '4.6', scenarioType: 'experiment',
    topic: 'students measure the mass of a glass of water + a spoonful of salt before and after mixing; the question asks the student to identify what happens to total mass when salt dissolves' },
  { id: 'g4s-friction-floor-surface', grade: '4', strand: 'Force, Motion & Energy', se: '4.7', scenarioType: 'experiment',
    topic: 'students push a small box across carpet and then across a smooth tile floor with the same force; the question asks the student to identify which surface has more friction and why the box moves differently' },
  { id: 'g4s-ramp-ball-energy', grade: '4', strand: 'Force, Motion & Energy', se: '4.8A', scenarioType: 'experiment',
    topic: 'a marble rolling down a ramp hits a small block; the question asks the student to identify how the marble transferred energy to the block' },
  { id: 'g4s-water-cycle-sun', grade: '4', strand: 'Earth & Space', se: '4.10A', scenarioType: 'described_diagram',
    topic: 'a description of a water-cycle diagram with the Sun, ocean, clouds, and rain labeled; the question asks the student to identify the role of the Sun in the cycle' },
  { id: 'g4s-erosion-river-canyon', grade: '4', strand: 'Earth & Space', se: '4.10B', scenarioType: 'experiment',
    topic: 'students pour water down a sand model and watch a small canyon form; the question asks the student to identify the process that creates real canyons over a long time' },
  { id: 'g4s-weather-vs-climate', grade: '4', strand: 'Earth & Space', se: '4.10C', scenarioType: 'data_analysis',
    topic: 'a chart showing temperatures for one week in Houston compared to monthly averages over 30 years; the question asks the student to identify which is weather and which is climate' },
  { id: 'g4s-renewable-vs-nonrenewable', grade: '4', strand: 'Earth & Space', se: '4.11A', scenarioType: 'data_analysis',
    topic: 'a list of energy sources (wind, oil, sunlight, natural gas, water flowing through dams); the question asks the student to identify which are renewable and which are nonrenewable' },
  { id: 'g4s-food-web-grass-rabbit-fox', grade: '4', strand: 'Organisms & Environments', se: '4.12B', scenarioType: 'described_diagram',
    topic: 'a description of a Texas grassland food web — sun → grass → rabbits → foxes; the question asks the student to identify what would happen to the foxes if drought killed most of the grass' },

  // ===========================================================
  // ----- Grade 6 (TEKS §112.26) — practice-only -----
  // ===========================================================
  { id: 'g6s-periodic-table-metals', grade: '6', strand: 'Matter & Energy', se: '6.6C', scenarioType: 'data_analysis',
    topic: "a small portion of the periodic table showing iron, copper, gold, sulfur, and silicon; the question asks the student to identify which are metals and what physical property they share" },
  { id: 'g6s-density-fluids-comparison', grade: '6', strand: 'Matter & Energy', se: '6.6D', scenarioType: 'experiment',
    topic: 'students layer honey, water, and oil in a glass; the question asks the student to identify which liquid is most dense and how density determined the layer order' },
  { id: 'g6s-chemical-change-precipitate', grade: '6', strand: 'Matter & Energy', se: '6.6E', scenarioType: 'experiment',
    topic: 'students mix two clear liquids in a beaker and a white solid forms; the question asks the student to identify what evidence shows a chemical change occurred' },
  { id: 'g6s-net-force-tug-of-war', grade: '6', strand: 'Force, Motion & Energy', se: '6.7B', scenarioType: 'experiment',
    topic: 'in a tug-of-war, one team pulls with 80 N and the other with 50 N in opposite directions; the question asks the student to calculate net force and identify which way the rope moves' },
  { id: 'g6s-energy-circuit-flow', grade: '6', strand: 'Force, Motion & Energy', se: '6.8B', scenarioType: 'described_diagram',
    topic: 'a description of a simple circuit with a battery, wires, a switch, and a light bulb; the question asks the student to identify how energy is conserved as it transfers from the battery to the bulb' },
  { id: 'g6s-transverse-vs-longitudinal', grade: '6', strand: 'Force, Motion & Energy', se: '6.8C', scenarioType: 'described_diagram',
    topic: 'a description of two waves: a rope wave (sideways motion) and a sound wave (compression/expansion); the question asks the student to identify which is transverse and which is longitudinal' },
  { id: 'g6s-seasons-axis-tilt', grade: '6', strand: 'Earth & Space', se: '6.9A', scenarioType: 'described_diagram',
    topic: "a description of Earth tilted on its axis revolving around the Sun; in June Earth's northern hemisphere tilts toward the Sun; the question asks the student to identify why this causes summer in the northern hemisphere" },
  { id: 'g6s-spring-vs-neap-tides', grade: '6', strand: 'Earth & Space', se: '6.9B', scenarioType: 'described_diagram',
    topic: 'a description of Sun-Earth-Moon alignment during spring tides (aligned) and neap tides (right angle); the question asks the student to identify which alignment causes the highest high tides' },
  { id: 'g6s-earth-layers-density', grade: '6', strand: 'Earth & Space', se: '6.10B', scenarioType: 'described_diagram',
    topic: "a cross-section of Earth labeled inner core, outer core, mantle, crust; the question asks the student to identify which layer is most dense and why" },
  { id: 'g6s-ecosystem-competition', grade: '6', strand: 'Organisms & Environments', se: '6.12A', scenarioType: 'data_analysis',
    topic: 'a Texas pond ecosystem where two fish species compete for the same insects; data shows one species declines as the other grows; the question asks the student to identify the biotic and abiotic factors at play' },

  // ===========================================================
  // ----- Grade 7 (TEKS §112.27) — practice-only -----
  // ===========================================================
  { id: 'g7s-chemical-formula-atoms', grade: '7', strand: 'Matter & Energy', se: '7.6B', scenarioType: 'data_analysis',
    topic: 'a chemical formula H₂SO₄ (sulfuric acid); the question asks the student to identify how many atoms of each element are in one molecule' },
  { id: 'g7s-physical-vs-chemical-change', grade: '7', strand: 'Matter & Energy', se: '7.6C', scenarioType: 'experiment',
    topic: 'students melt ice in one beaker and burn paper in another; the question asks the student to identify which is a physical change and which is a chemical change and why' },
  { id: 'g7s-average-speed-calculation', grade: '7', strand: 'Force, Motion & Energy', se: '7.7A', scenarioType: 'experiment',
    topic: 'a student records that a toy car traveled 6 meters in 3 seconds; the question asks the student to calculate the average speed using distance and time' },
  { id: 'g7s-distance-time-graph', grade: '7', strand: 'Force, Motion & Energy', se: '7.7C', scenarioType: 'data_analysis',
    topic: 'a distance-time graph showing a flat segment, then a steep upward segment, then another flat segment; the question asks the student to identify what the slope tells about the object’s motion in each section' },
  { id: 'g7s-conduction-convection-radiation', grade: '7', strand: 'Force, Motion & Energy', se: '7.8A', scenarioType: 'experiment',
    topic: 'students set up three demonstrations: a metal spoon in hot water, a beaker of water on a hot plate showing rising currents, and a thermometer near a heat lamp; the question asks the student to label each as conduction, convection, or radiation' },
  { id: 'g7s-temperature-kinetic-energy', grade: '7', strand: 'Force, Motion & Energy', se: '7.8C', scenarioType: 'described_diagram',
    topic: 'a description of cold water particles moving slowly and hot water particles moving fast; the question asks the student to identify the relationship between temperature and the kinetic energy of particles' },
  { id: 'g7s-plate-tectonics-mountain-building', grade: '7', strand: 'Earth & Space', se: '7.10B', scenarioType: 'described_diagram',
    topic: 'a description of two continental plates colliding over millions of years; the question asks the student to identify what happens at the boundary and what type of landform forms' },
  { id: 'g7s-fossil-record-evidence', grade: '7', strand: 'Earth & Space', se: '7.10A', scenarioType: 'data_analysis',
    topic: 'rock layers showing fossils — trilobites in the lowest layer, dinosaurs in the middle, mammals near the top; the question asks the student to identify what the order tells about life on Earth and the law of superposition' },
  { id: 'g7s-trophic-pyramid-energy-loss', grade: '7', strand: 'Organisms & Environments', se: '7.12A', scenarioType: 'data_analysis',
    topic: 'a trophic pyramid showing 10,000 calories at the producer level, 1,000 at primary consumer, 100 at secondary consumer; the question asks the student to identify why energy decreases at each level' },
  { id: 'g7s-body-systems-circulatory', grade: '7', strand: 'Organisms & Environments', se: '7.13A', scenarioType: 'described_diagram',
    topic: 'a description of how the circulatory system works with the lungs (respiratory system) to supply the body with oxygen; the question asks the student to identify how two body systems coordinate' }
];

let _ddbClient = null, _PutCommand = null, _ScanCommand = null;
function getDdb() {
  if (_ddbClient) return { ddb: _ddbClient, PutCommand: _PutCommand, ScanCommand: _ScanCommand };
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const lib = require('@aws-sdk/lib-dynamodb');
  _PutCommand = lib.PutCommand;
  _ScanCommand = lib.ScanCommand;
  _ddbClient = lib.DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
  return { ddb: _ddbClient, PutCommand: _PutCommand, ScanCommand: _ScanCommand };
}

function parseArgs(argv) {
  const opts = { dryRun: true, briefId: null, grade: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--write') opts.dryRun = false;
    else if (argv[i] === '--brief-id') opts.briefId = argv[++i];
    else if (argv[i] === '--grade') opts.grade = String(argv[++i]).toLowerCase();
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: run-seed-openai.js [--brief-id <id>] [--write]');
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
        temperature: (opts && typeof opts.temperature === 'number') ? opts.temperature : 0.6,
        max_tokens: (opts && opts.max_tokens) || 2200
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
    }
    return await res.json();
  } finally { clearTimeout(timer); }
}

function buildScenarioSystem(grade) {
  const earlyReader = ['k', '1', '2'].includes(String(grade).toLowerCase());
  const earlyReaderRules = earlyReader ? `

== EARLY-READER RULES (HARD — applies to grades K/1/2) ==
- Sentences are SHORT. Average 5-9 words per sentence. Never more than 14 words.
- Vocabulary is concrete and common. No abstract or technical terms ("ecosystem" → "the place where animals live").
- Use simple subject-verb-object structure. Avoid subordinate clauses.
- Scenario length: 50-130 words total (NOT the 80-180 of older grades).
- Frame everything as something a 5-7yo could observe with their own eyes — a backyard, a kitchen sink, a class pet.
- Numbers are small whole numbers (3 ducks, 2 cups, 5 days).
` : '';
  const audience = earlyReader
    ? `5-7-year-old students (Kindergarten through Grade 2). Vocabulary at early-reader level (Tier 1 only — common everyday words).`
    : `13-14-year-old students. Vocabulary at grade-${grade} science level. Real STAAR Grade ${grade} stimulus passages cluster around 80-180 words plus a labeled visual (we generate text only — no images, but you can verbally describe the setup as if a kid were reading the passage and then looking at a photo or diagram).`;
  const scope = earlyReader
    ? 'practice-only science for Kindergarten/Grade 1/Grade 2 — concrete observations of nature, simple cause-and-effect a young kid can see.'
    : `Texas TEKS science for Grade ${grade}, covering Matter & Energy, Force/Motion/Energy, Earth & Space, and Organisms & Environments.`;
  return `You write science-stimulus scenarios for a Texas Grade ${grade} science practice app. Scope: ${scope}${earlyReaderRules}

== Audience ==
${audience}

== Output format (STRICT JSON) ==

{
  "title": "Short scenario title",
  "body": "## Title\\n\\nFirst paragraph of the experiment / data table description / diagram description.\\n\\n(optional second paragraph)",
  "topicNotes": "1-line internal note on the SE addressed"
}

== Body format ==
- Markdown. Open with "## " + title. 1-3 paragraphs.
- 80-180 words total. Real STAAR stimulus length.
- For experiments: describe the setup in plain language ("students place X on Y and measure Z").
- For data analysis: describe the data table or graph in words ("the table shows three trials...").
- For described diagrams: describe the diagram in words ("the diagram shows a labeled animal cell with...").
- DO NOT include images, HTML tags, or inline paragraph numbers.

== Strict-pass requirements ==
- Stay within Texas TEKS §112.28 Grade 8 scope.
- Names of scientific concepts should be accurate.
- Numbers should be physically realistic (e.g. tropical cyclone wind speeds in the 75+ mph range).
- The scenario must support a multiple-choice question that tests the SE listed in the brief.

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildScenarioUser(brief) {
  const earlyReader = ['k', '1', '2'].includes(String(brief.grade).toLowerCase());
  const wordTarget = earlyReader ? '50-130' : '80-180';
  return `Generate ONE science scenario for Texas Grade ${brief.grade}.

TEKS SE: ${brief.se}
Strand: ${brief.strand}
Scenario type: ${brief.scenarioType}
Topic: ${brief.topic}

Match the ${wordTarget} word target. Apply ALL rules. Return strict JSON.`;
}

function buildQuestionsSystem(grade) {
  const earlyReader = ['k', '1', '2'].includes(String(grade).toLowerCase());
  const earlyReaderRules = earlyReader ? `

For grades K/1/2: stick to OBSERVATION ('what did the kid see?') and SIMPLE CAUSE ('why did the rock sink?'). Skip data-interpretation tables and prediction-of-variables — too abstract. Question stems and answer choices use ≤8 words each. Vocabulary is early-reader level.
` : '';
  return `You write multiple-choice science questions for a Texas Grade ${grade} practice app, given a scenario stimulus. Questions test:${earlyReaderRules}
- Direct application of the SE concept
- Data interpretation from the scenario
- Cause-effect within the scientific phenomenon
- Predicting what would happen if a variable changes

Output STRICT JSON:

{
  "questions": [
    {
      "stem": "Question text",
      "choices": ["A", "B", "C", "D"],
      "correctIndex": 2,
      "explanation": "Brief: cite specific scenario evidence + scientific reasoning. 1-2 sentences.",
      "questionType": "concept-application | data-interpretation | cause-effect | prediction"
    }
  ]
}

Rules (LOCKED):
- Exactly 5 questions per scenario.
- Mix question types — at least 3 distinct types across the 5.
- Exactly 4 choices each, one correct.
- Distractors plausible — common misconceptions or partially-true statements.
- Question must be answerable from the scenario + grade-8 science knowledge.
- Explanation cites specific scenario evidence ("the chart shows X, which means Y").
- AT LEAST ONE distractor per question reflects a documented misconception (CLAUDE.md §38 KP).

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildQuestionsUser(scenario) {
  return `Generate 5 science questions for the scenario below.

Title: ${scenario.title}

Scenario:
${scenario.body}

Return strict JSON.`;
}

function nowIso() { return new Date().toISOString(); }
function shortId() { return crypto.randomBytes(6).toString('hex'); }
function ensureOutputDir() { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); }

async function processBrief(brief, opts, apiKey) {
  console.log(`\n=== ${brief.id} (${brief.strand} · ${brief.se}) ===`);
  console.log(`topic: ${brief.topic.slice(0, 80)}${brief.topic.length > 80 ? '…' : ''}`);

  // Stage 1: scenario
  console.log('  ⏳ generating scenario…');
  const sSys = buildScenarioSystem(brief.grade);
  const sUser = buildScenarioUser(brief);
  let scenarioRaw;
  try {
    const resp = await callOpenAI(sSys, sUser, apiKey, { temperature: 0.6, max_tokens: 1200 });
    scenarioRaw = resp.choices[0].message.content;
  } catch (err) {
    console.error(`  ✗ scenario gen failed: ${err.message.slice(0, 120)}`);
    return { ok: false, brief, stage: 'scenario', error: err.message };
  }
  let scenarioJson;
  try { scenarioJson = JSON.parse(scenarioRaw); }
  catch (err) {
    console.error(`  ✗ scenario non-JSON: ${err.message.slice(0, 80)}`);
    return { ok: false, brief, stage: 'scenario-parse', error: err.message };
  }
  const title = String(scenarioJson.title || '').trim();
  const body = String(scenarioJson.body || '').trim();
  if (!title || !body) {
    console.error('  ✗ scenario missing title or body');
    return { ok: false, brief, stage: 'scenario-empty' };
  }
  const wordCount = (body.match(/\S+/g) || []).length;
  console.log(`  ✓ scenario: "${title}" — ${wordCount}w`);
  if (wordCount < 60 || wordCount > 250) {
    console.warn(`  ⚠ word-count ${wordCount} outside target 60-250 (proceeding anyway)`);
  }

  // Stage 2: questions
  console.log('  ⏳ generating 5 questions…');
  const qSys = buildQuestionsSystem(brief.grade);
  const qUser = buildQuestionsUser({ title, body });
  let questionsRaw;
  try {
    const resp = await callOpenAI(qSys, qUser, apiKey, { temperature: 0.5, max_tokens: 2400 });
    questionsRaw = resp.choices[0].message.content;
  } catch (err) {
    console.error(`  ✗ questions gen failed: ${err.message.slice(0, 120)}`);
    return { ok: false, brief, stage: 'questions', error: err.message };
  }
  let questionsJson;
  try { questionsJson = JSON.parse(questionsRaw); }
  catch (err) {
    console.error(`  ✗ questions non-JSON: ${err.message.slice(0, 80)}`);
    return { ok: false, brief, stage: 'questions-parse', error: err.message };
  }
  const qs = Array.isArray(questionsJson.questions) ? questionsJson.questions : [];
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

  // Build records. Match the science schema established in Phase J:
  // stateGradeGenre uses '_science_scenario' suffix so the lambda's
  // existing handleGetScienceItem queries find these passages.
  const passageId = `p_tx_${brief.grade}_sci_${shortId()}`;
  const stateGradeGenre = `${STATE}_${brief.grade}_${SUBJECT}_scenario`;
  const passageRow = {
    passageId,
    state: STATE,
    grade: brief.grade,
    subject: SUBJECT,
    scenarioType: brief.scenarioType,
    stateGradeGenre,
    title,
    body,
    topic: brief.topic,
    topicNotes: String(scenarioJson.topicNotes || '').slice(0, 200),
    strand: brief.strand,
    targetTeks: brief.se,
    wordCount,
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'science-openai-v1',
    _briefId: brief.id
  };

  const poolKey = `${STATE}#${brief.grade}#${SUBJECT}#${passageId}`;
  const questionRows = validQs.map((q, idx) => ({
    poolKey,
    contentId: `q_${shortId()}_${idx}`,
    state: STATE,
    grade: brief.grade,
    subject: SUBJECT,
    type: 'multiple_choice',
    questionType: q.questionType || 'unknown',
    question: q.stem,
    choices: q.choices,
    correctIndex: q.correctIndex,
    answer: q.choices[q.correctIndex],
    explanation: q.explanation,
    passageId,
    strand: brief.strand,
    claimedTeks: brief.se,
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'science-openai-v1',
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

  let briefs = BRIEFS.slice();
  if (opts.briefId) briefs = briefs.filter(b => b.id === opts.briefId);
  if (opts.grade != null) briefs = briefs.filter(b => String(b.grade).toLowerCase() === opts.grade);
  if (!briefs.length) {
    console.error(`No briefs matched --brief-id=${opts.briefId || '(unset)'}`);
    process.exit(1);
  }

  // Idempotency
  if (!opts.dryRun) {
    try {
      const { ddb, ScanCommand } = getDdb();
      const briefIdSet = new Set(briefs.map(b => b.id));
      const scanned = [];
      let last;
      do {
        const r = await ddb.send(new ScanCommand({
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
  console.log(`[science-openai] runId=${runId} mode=${opts.dryRun ? 'dry-run' : 'WRITE'} briefs=${briefs.length}`);

  const results = [];
  for (const brief of briefs) {
    const r = await processBrief(brief, opts, apiKey);
    results.push(r);
    if (r.ok && !opts.dryRun) {
      try {
        await persist(r.passageRow, r.questionRows);
        console.log(`  ✓ persisted: scenario ${r.passageRow.passageId} + ${r.questionRows.length} questions`);
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

  const outPath = path.join(OUTPUT_DIR, `science-openai-${runId}.json`);
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
