# Texas Science Knowledge Pack — gradeearn.com

**Status:** v1 draft, 2026-05-07
**Owner:** Hamid Ali
**Scope:** Texas TEKS-aligned science content, Grades 3-8 + Biology
**Source authority:** TEA 19 TAC Chapter 112 (adopted 2021, effective 2024-2025), STAAR Science 2026 Assessed Curriculum
**Update cycle:** Annually, when TEA publishes new assessed curriculum (typically Jan)

---

## 0. Purpose

This document is the source of truth for the gradeearn.com science generator pipeline. Every science question, passage, and judge ruling references back to a Student Expectation (SE) defined here. When TEA changes the TEKS (next major review: not before 2031), this document updates and the generator re-runs.

The structure mirrors the existing Reading and Math Knowledge Packs. No new philosophy — same depth-first Texas-complete strategy.

---

## 1. STAAR Science 2026 facts (locked)

- **Tested grades:** Elementary STAAR Science (Grade 5), Middle School STAAR Science (Grade 8), Biology EOC
- **Practice-only grades on gradeearn:** 3, 4, 6, 7 (full TEKS coverage, "STAAR-tested" badge omitted)
- **Effective TEKS:** Adopted 2021, fully implemented Spring 2026
- **2027 change ahead:** Grade 5 STAAR will pull more Grade 3 SEs starting Spring 2027 — generator must accept eligibility list as config, not hardcode
- **Reference materials:**
  - Grade 5 (Elementary): NONE
  - Grade 8 (Middle School): periodic table + formula sheet + ruler
  - Biology: periodic table + formulas + reference diagrams

---

## 2. Strand structure (consistent across all grades)

Every grade 3-8 follows 4 recurring strands, plus 5th meta-strand for science process:

| Strand | What it covers |
|---|---|
| **Scientific & Engineering Practices** | Inquiry, investigation design, safety, tools, models, communication. Embedded in every test. |
| **Matter & Energy** | Properties of matter, states, mixtures, conservation of mass, atomic structure |
| **Force, Motion & Energy** | Forces, motion, energy transfer, electricity, light, sound, waves |
| **Earth & Space** | Earth processes, weather, climate, solar system, geology, plate tectonics |
| **Organisms & Environments** | Ecosystems, life cycles, adaptations, food webs, structure-function |

Biology reorganizes into 4 strands:
1. Biological Structures, Functions, & Processes
2. Mechanisms of Genetics
3. Biological Evolution
4. Interdependence within Environmental Systems

---

## 3. Full SE catalog by grade

### Grade 3 (TEKS §112.5)

**Matter & Energy**
- 3.6(A) measure, test, record physical properties (temperature, mass, magnetism, sink/float)
- 3.6(B) classify matter as solid/liquid/gas; demonstrate solids have definite shape, liquids/gases take container shape
- 3.6(C) predict, observe, record state changes from heating/cooling — *STAAR Grade 5 reach-back*
- 3.6(D) combine materials based on physical properties to create/modify objects

**Force, Motion & Energy**
- 3.7(A) demonstrate forces acting on object (magnetism, gravity, push/pull) — *STAAR Grade 5 reach-back*
- 3.7(B) plan/conduct investigation showing position/motion changed by push/pull — *STAAR Grade 5 reach-back*
- 3.8(A) identify everyday energy examples (light, sound, thermal, mechanical)
- 3.8(B) plan/conduct investigation: speed of object related to mechanical energy

**Earth & Space**
- 3.9(A) construct models, explain orbits of Sun, Earth, Moon
- 3.9(B) identify order of planets in solar system — *STAAR Grade 5 reach-back*
- 3.10(A) compare/describe day-to-day weather (air temp, wind direction, precipitation)
- 3.10(B) investigate/explain how soils (sand, clay) form by weathering and decomposition
- 3.10(C) model/describe rapid Earth-surface changes (volcanic eruptions, earthquakes, landslides) — *STAAR Grade 5 reach-back*
- 3.11(A-C) natural resources, conservation, reduce/reuse/recycle

**Organisms & Environments**
- 3.12(A) explain temperature/precipitation effects on animals (migration, hibernation) and plants (dormancy)
- 3.12(B) identify flow of energy in food chain; predict effects of changes (e.g., remove frogs from pond) — *STAAR Grade 5 reach-back*
- 3.12(C) describe natural environment changes (floods, droughts) effects on organisms
- 3.12(D) identify fossils as evidence of past organisms; **including common Texas fossils** — *STAAR Grade 5 reach-back*
- 3.13(A) explore/explain external structures helping animal survival (giraffe neck, duck webbed feet)
- 3.13(B) explore/illustrate/compare life cycles (beetles, crickets, radishes, lima beans)

---

### Grade 4 (TEKS §112.6)

**Matter & Energy**
- 4.6(A-D) properties (mass, volume, states, magnetism, density), mixtures including solutions, conservation of matter

**Force, Motion & Energy**
- 4.7 forces: friction, gravity, magnetism — investigate effects on objects
- 4.8(A) investigate/identify transfer of energy by objects in motion, water waves, sound — *STAAR Grade 5 reach-back*
- 4.8 differentiate mechanical, sound, light, thermal, electrical energy; conductors vs insulators

**Earth & Space**
- 4.9(A) collect/analyze data: predict patterns of seasonal change (temperature, daylight) — *STAAR Grade 5 reach-back*
- 4.9(B) collect/analyze data: predict Moon-appearance patterns — *STAAR Grade 5 reach-back*
- 4.10(A) describe/illustrate water cycle, role of Sun as energy source — *STAAR Grade 5 reach-back*
- 4.10(B) model/describe weathering, erosion, deposition — *STAAR Grade 5 reach-back*
- 4.10(C) differentiate weather and climate — *STAAR Grade 5 reach-back*
- 4.11(A) advantages/disadvantages of renewable vs nonrenewable resources (wind, water, sunlight, plants, animals, coal, oil, natural gas) — *STAAR Grade 5 reach-back*

**Organisms & Environments**
- 4.12 producers, food webs, energy flow
- 4.12(B) cycling of matter and flow of energy through food webs (Sun, producers, consumers, decomposers) — *STAAR Grade 5 reach-back*
- 4.13 plant structures, inherited vs acquired traits

---

### Grade 5 (TEKS §112.7) — STAAR-TESTED

**Matter & Energy**
- 5.6(A) compare/contrast matter by properties: mass, magnetism, relative density, physical state, volume, solubility, thermal/electric conductivity — **Readiness**
- 5.6(B) demonstrate mixtures retain physical properties (iron filings + sand, sand + water) — Supporting
- 5.6(C) compare substance properties before/after solution; matter is conserved in solutions — Supporting

**Force, Motion & Energy**
- 5.7(A) investigate/explain equal vs unequal forces causing motion patterns and energy transfer — Supporting
- 5.7(B) design simple investigation testing force on object (car on ramp, balloon rocket on string) — Supporting
- 5.8(B) electrical energy in complete circuits transforms to motion/light/sound/thermal; identify circuit requirements — **Readiness**
- 5.8(C) demonstrate light travels in straight line; can be reflected, refracted, absorbed — **Readiness**

**Earth & Space**
- 5.9(A) Earth rotates on axis ~24 hrs; causes day/night, Sun's apparent motion, shadow changes — **Readiness**
- 5.10(A) Sun-ocean interaction in water cycle, weather effects — Supporting
- 5.10(B) processes forming sedimentary rocks and fossil fuels — **Readiness**
- 5.10(C) wind/water/ice forming landforms (deltas, canyons, sand dunes) — **Readiness**

**Organisms & Environments**
- 5.12(A) organisms surviving by interacting with biotic + abiotic factors in healthy ecosystem — **Readiness**
- 5.13(A) analyze structures/functions of different species surviving in same environment — **Readiness**

---

### Grade 6 (TEKS §112.26)

**Matter & Energy**
- 6.6(C) identify periodic table elements as metals/nonmetals/metalloids/rare Earth, by physical properties and modern-life importance
- 6.6(D) compare density of substances relative to fluids
- 6.6(E) identify new substance formation: gas production, thermal energy change, precipitate, color change

**Force, Motion & Energy**
- 6.7(A) identify/explain forces: gravity, friction, magnetism, applied, normal — real-world applications
- 6.7(B) calculate net force in horizontal/vertical direction; balanced vs unbalanced
- 6.8(B) energy conservation in transfers/transformations (electrical circuits, food webs, amusement park rides, photosynthesis)
- 6.8(C) energy transferred through transverse and longitudinal waves

**Earth & Space**
- 6.9(A) tilted Earth revolves around Sun → seasons
- 6.9(B) Earth-Sun-Moon positions cause daily, spring, neap tides via gravity
- 6.10(B) layers of Earth: inner core, outer core, mantle, crust

**Organisms & Environments**
- 6.12(A) organisms in ecosystem depend on/compete for biotic (food) + abiotic (light, water, temperature, soil) factors
- 6.13(A) historical development of cell theory; organisms are one or more cells from pre-existing cells

---

### Grade 7 (TEKS §112.27)

**Matter & Energy**
- 7.6(B) periodic table: identify atoms and number of each in chemical formula — **Readiness**
- 7.6(C) physical vs chemical changes in matter — Supporting

**Force, Motion & Energy**
- 7.7(A) calculate average speed using distance/time
- 7.7(B) speed vs velocity (distance, displacement, direction)
- 7.7(C) measure/record/interpret motion using distance-time graphs
- 7.8(A) thermal energy transfer: conduction, convection, radiation
- 7.8(C) relationship between temperature and kinetic energy of particles

**Earth & Space**
- 7.9(B) gravity governs solar system motion
- 7.10(A) evidence Earth has changed: fossil record, plate tectonics, superposition
- 7.10(B) plate tectonics → ocean basin formation, earthquakes, mountain building, volcanic eruptions, supervolcanoes, hot spots — **Readiness**
- 7.11(A-B) human impact on hydrosphere: groundwater, surface water, oceans

**Organisms & Environments**
- 7.12(A) energy flow within trophic levels, energy decreases up trophic pyramid
- 7.13(A) human body systems: circulatory, respiratory, skeletal, muscular, digestive, urinary, reproductive, integumentary, nervous, immune, endocrine
- 7.13(C) asexual vs sexual reproduction in plants/animals
- 7.13(D) natural and artificial selection examples

---

### Grade 8 (TEKS §112.28) — STAAR-TESTED

**Matter & Energy**
- 8.6(E) conservation of mass in chemical reactions; rearrangement of atoms; chemical equations including photosynthesis — **Readiness**

**Force, Motion & Energy**
- 8.7(A) Newton's Second Law: a = F/m calculations and analysis — **Readiness**
- 8.7(B) Newton's three laws acting simultaneously (vehicle restraints, sports, amusement parks, tectonics, rockets) — **Readiness**
- 8.8(A) wave characteristics: amplitude, frequency, wavelength in transverse waves, electromagnetic spectrum — Supporting

**Earth & Space**
- 8.9(A) star life cycle; classify stars using Hertzsprung-Russell diagram — **Readiness**
- 8.9(B) galaxy types (spiral, elliptical, irregular); locate Earth's solar system in Milky Way — Supporting
- 8.10(A) Sun + hydrosphere + atmosphere → weather and climate — **Readiness**
- 8.10(B) global atmospheric movement patterns → local weather — Supporting
- 8.10(C) ocean currents + air masses → tropical cyclones (typhoons, hurricanes) — Supporting

**Organisms & Environments**
- 8.12(B) primary vs secondary ecological succession after disruption — **Readiness**
- 8.12(C) biodiversity → ecosystem stability and organism health — Supporting
- 8.13(A) cell organelle functions: cell membrane, cell wall, nucleus, ribosomes, cytoplasm, mitochondria, chloroplasts, vacuoles — **Readiness**
- 8.13(B) gene function within chromosomes, inherited traits — Supporting
- 8.13(C) trait variation → structural/behavioral/physiological adaptations → reproductive success — **Readiness**

---

### Biology (TEKS §112.42) — STAAR-TESTED EOC

**Biological Structures, Functions, & Processes**
- B.5(A) biomolecule structure-function: carbs, lipids, proteins, nucleic acids — Supporting
- B.5(B) prokaryotic vs eukaryotic cells; cellular complexity — **Readiness**
- B.5(D) viruses vs cells; virus spread and disease — Supporting
- B.6(A) cell cycle stages; DNA replication models — Supporting
- B.6(B) cell specialization, differentiation, environmental factors — Supporting
- B.6(C) cell cycle disruptions → diseases like cancer — **Readiness**
- B.11(A) matter conservation, energy transfer in photosynthesis and cellular respiration; chemical equations — Supporting
- B.11(B) enzymes facilitate cellular processes — **Readiness**
- B.12(A) systems interactions in animals: regulation, nutrient absorption, reproduction, defense — Supporting
- B.12(B) plant systems: transport, reproduction, response — **Readiness**

**Mechanisms of Genetics**
- B.7(A) DNA components; nucleotide sequence specifies traits — Supporting
- B.7(B) gene expression; protein synthesis using DNA/RNA models — Supporting
- B.7(C) DNA changes (mutations) and significance — **Readiness**
- B.8(A) chromosome reduction, independent assortment, crossing-over in meiosis → diversity — Supporting
- B.8(B) Mendelian + non-Mendelian: monohybrid, dihybrid crosses, incomplete dominance, codominance, sex-linked, multiple alleles — **Readiness**

**Biological Evolution**
- B.9(A) common ancestry evidence: fossil record, biogeography, anatomical/molecular/developmental homologies — Supporting
- B.9(B) gradualism, abrupt appearance, stasis in fossil record — **Readiness**
- B.10(A) natural selection acts on populations not individuals — Supporting
- B.10(B) elements of natural selection: variation, overproduction, finite resources → differential reproduction — **Readiness**
- B.10(C) natural selection → speciation — **Readiness**
- B.10(D) other mechanisms: genetic drift, gene flow, mutation, recombination — Supporting

**Interdependence within Environmental Systems**
- B.13(A) ecological relationships: predation, parasitism, commensalism, mutualism, competition — Supporting
- B.13(B) disruption of matter cycling/energy flow → ecosystem stability — Supporting
- B.13(C) carbon and nitrogen cycles; consequences of disruption — Supporting
- B.13(D) environmental change (incl. human activity) → biodiversity → ecosystem stability — **Readiness**

---

## 4. Texas regional context tags

The generator should pull a region tag with each question. This is the "Texas-flavored" layer. ~30-40% of questions should reference a region; rest can be generic.

| Region | Cities | Science contexts to draw from |
|---|---|---|
| **Gulf Coast** | Houston, Galveston, Corpus Christi | NASA Johnson Space Center, oil refineries, hurricanes, ship channels, gulf marine life, sea turtles, mangroves |
| **South Texas / RGV** | San Antonio, McAllen, Brownsville, Laredo | Spanish missions, droughts, citrus farming, white-tailed deer, prickly pear cactus, Edwards Aquifer |
| **Hill Country** | Austin, Fredericksburg, Kerrville | Limestone caves, springs (Barton Springs, Comal Springs), Mexican free-tailed bats (Bracken Cave), live oaks, flash flooding |
| **East Texas / Piney Woods** | Tyler, Lufkin, Nacogdoches | Loblolly pine forests, Big Thicket biodiversity, swamps, lumber industry, alligators |
| **North Texas / DFW** | Dallas, Fort Worth | Tornadoes, supercell thunderstorms, blackland prairie, drought, urban heat island |
| **West Texas / Big Bend** | El Paso, Midland, Odessa, Marfa | Chihuahuan Desert, dark sky reserve (McDonald Observatory), Guadalupe Mountains, Permian Basin oil, javelinas |
| **Panhandle** | Amarillo, Lubbock | Wind farms, Llano Estacado plains, ranching, Palo Duro Canyon, Ogallala Aquifer, dust storms |

**Common Texas fossils** (per TEKS 3.12(D) which explicitly names them): mosasaurs, ammonites, dinosaur tracks (Glen Rose), petrified wood, mammoth bones (Waco), Cretaceous sea creatures.

**Other Texas-specific science topics:**
- Texas state symbols with biology angle: Mexican free-tailed bat (mammal), bluebonnet (flower), pecan (tree), monarch butterfly (insect)
- Native species: armadillo, mockingbird, longhorn, prickly pear, mesquite
- Invasive concerns: zebra mussels, fire ants, feral hogs
- Climate: humid subtropical (east), semi-arid (west), continental (panhandle)

---

## 5. Common misconceptions library (top 5 per major topic)

Distractor design rule: at least one of three wrong answers per question should reflect a documented misconception. This makes the question pedagogically honest — kids who answer wrong reveal a real gap, not a random guess.

### Matter & Energy
1. "Heavier objects sink, lighter objects float" (density confusion)
2. "Gas isn't matter" or "gas weighs nothing" (mass conservation)
3. "When ice melts the mass changes" (state change ≠ mass change)
4. "Mixtures and solutions are the same thing"
5. "Atoms are alive" or "atoms can be created/destroyed"

### Force, Motion & Energy
1. "Heavy objects fall faster than light ones" (Aristotelian intuition)
2. "When an object stops moving, it has no force on it" (vs. balanced forces)
3. "Energy gets used up" (vs. transformed/transferred)
4. "Light is just there — it doesn't travel" (vs. straight-line travel)
5. "Magnets attract everything metal" (vs. only ferromagnetic)

### Earth & Space
1. "The Sun moves across the sky" (vs. Earth rotates)
2. "Seasons are caused by Earth's distance from Sun" (vs. axial tilt)
3. "The Moon makes its own light" (vs. reflects sunlight)
4. "Erosion and weathering are the same thing"
5. "Climate and weather are interchangeable"

### Organisms & Environments
1. "Plants get food from the soil" (vs. photosynthesis)
2. "Big animals are predators, small animals are prey" (oversimplification)
3. "Decomposers are not part of food webs"
4. "Adaptations happen in the individual's lifetime" (Lamarckian, vs. populations over generations)
5. "Evolution has a goal / progresses toward complexity"

### Biology
1. "Genes and chromosomes are the same thing"
2. "Evolution = humans came from monkeys" (vs. common ancestor)
3. "Mutations are always harmful"
4. "Cells without a nucleus are 'simpler' or 'primitive'"
5. "Photosynthesis only happens in leaves" (vs. anywhere with chlorophyll)

These should expand over time. Sources to mine for v2: AAAS Project 2061, NSTA Reader-Friendly Misconception List, NARST research papers, Driver "Making Sense of Secondary Science."

---

## 6. Sample question patterns by item type (text-only v1)

### Pattern A — Standalone multiple choice
Q: A scientist investigates how forces affect a toy car rolling down a ramp.
The toy car has a mass of 0.5 kg. Which of these would cause the car to
accelerate the most?

A. A gentle push down the ramp
B. A strong push down the ramp
C. A gentle push against the direction of the ramp
D. No force at all

correctIndex: 1
explanation: Per Newton's Second Law (F=ma), greater force on the same mass
produces greater acceleration. A strong push gives the car
the most acceleration in the direction of motion.
tek_code: 8.7(A)
strand: Force, Motion & Energy


### Pattern B — Lab scenario passage + cluster questions
Passage:
"Maria is testing how the temperature of water affects how quickly sugar
dissolves. She fills three identical glasses with 200 mL of water:
Glass 1 holds cold water (10°C), Glass 2 holds room-temperature water (25°C),
and Glass 3 holds hot water (50°C). She adds 5 grams of sugar to each
glass at the same time and stirs each glass 10 times. She records the
time it takes for all the sugar to dissolve."

Q1: What is the independent variable in Maria's investigation?
A. The amount of sugar       B. The amount of water
C. The temperature of water  D. The number of stirs
correctIndex: 2

Q2: Why did Maria use the same amount of water in each glass?
A. To make the sugar dissolve faster
B. To control variables that aren't being tested
C. So all the water would be at the same temperature
D. Because the glasses are identical
correctIndex: 1

Q3: Maria's results showed sugar dissolved fastest in Glass 3. What does this
suggest about the relationship between temperature and dissolving rate?
A. Higher temperature decreases dissolving rate
B. Higher temperature increases dissolving rate
C. Temperature has no effect on dissolving rate
D. Only cold water dissolves sugar
correctIndex: 1


### Pattern C — Texas-flavored question
Q: During hurricane season, the Texas Gulf Coast experiences powerful tropical
cyclones forming over the Gulf of Mexico. What two systems interacting
produce these storms?

A. Ocean currents and air masses
B. Plate tectonics and ocean currents
C. Earth's rotation and the Moon's gravity
D. The Sun and the rock cycle

correctIndex: 0
region_tag: gulf_coast
tek_code: 8.10(C)


---

## 7. Generation rules (lock these in the generator prompt)

1. Every question must reference exactly ONE primary tek_code. Cluster questions can reference a secondary tek_code.
2. Every question must declare strand from the 4-strand taxonomy.
3. Every question must declare standard_type: "Readiness" or "Supporting" (for STAAR-tested grades only — 5, 8, Bio).
4. Questions for grades 3, 4, 6, 7 mark standard_type: "Practice" (no STAAR weight assigned).
5. Vocabulary must be at or below grade-band reading level. Use Flesch-Kincaid as a soft check.
6. No diagrams in v1. Questions that *require* a diagram to answer are out of scope and the generator must reject them.
7. Lab scenarios are allowed and welcomed (cluster patterns) — they don't require diagrams, just text.
8. Region tags optional but encouraged: ~30-40% of questions should carry a region_tag.
9. Distractors: at least 1 of 3 wrong answers per multi-choice should reflect a misconception from §5.
10. No question may have two equally-correct answers (the 271142 rule from existing judge applies here too).

---

## 8. What's NOT in this pack (deferred / out of scope)

- Grades K-2 Science (not in gradeearn scope)
- Chemistry, Physics, Integrated Physics & Chemistry EOCs (high school beyond Bio — defer to Phase 2)
- Diagram-based items (Phase 2 once curated SVG library exists)
- Constructed response (rubric judge needed — defer)
- Drag-and-drop, hot-spot, match-table-grid item types (UI build needed — defer)
- Spanish-language items (TEA offers Grade 5 in Spanish — defer)

---

## 9. Document version history

- v1 (2026-05-07): Initial draft. Covers Grades 3-8 + Biology under TEKS §112.5-112.7, §112.26-112.28, §112.42 (adopted 2021). Source: TEA 19 TAC Chapter 112 (Aug 2024 update) and STAAR Science 2026 Assessed Curriculum docs.

---

**END OF KNOWLEDGE PACK**
