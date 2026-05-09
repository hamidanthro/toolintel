# Phase J — pilot sample-10 review

Sampled 10 questions from 41 now-active across 9 scenarios.

Pipeline that produced these: Opus 4.7 generator → Sonnet 4.5 verifier → Sonnet 4.5 judge. Each question independently verified for TEK alignment + science accuracy + answer-pick agreement, then judged against 9 reason codes (TEK_MISMATCH, ANSWER_FOUND_IN_PROMPT, SCIENCE_FACTUAL_ERROR, DIAGRAM_REQUIRED, LAB_SAFETY_VIOLATION, etc.). Survivors below.

## Question 1 — 5.6B — Matter & Energy
*pick reason: strand: Matter & Energy*

**Stem:** After the students in Ms. Rodriguez's class stirred the rice and beans together for 30 seconds, what did they most likely observe about the rice grains and the beans?

**Choices:**
  - A. The rice grains were still white and small, and the beans were still black and larger.
  - B. The rice grains turned black and the beans turned white after stirring.
  - C. The rice and beans combined to form one new type of grain.
  - D. The rice grains disappeared into the beans and could no longer be seen.

**Correct:** A

**Explanation:** When two materials are mixed physically, each one keeps its own physical properties. The rice stayed white and small, and the beans stayed black and larger.

**Region:** none

**Verifier:** pass (conf 1) · agreed=true · tek=aligned · science=true

**Judge:** pass (conf 0.95) reasons=[]

**Scenario context (truncated):** Ms. Rodriguez asked her class to investigate what happens when two different materials are combined. Each student received one cup of white rice and one cup of black beans. The students poured both cu…

---

## Question 2 — 5.7A — Force, Motion & Energy
*pick reason: strand: Force, Motion & Energy*

**Stem:** In the first round of Ms. Rodriguez's tug-of-war, Team A pulled east with 300 newtons and Team B pulled west with 300 newtons, and the rope did not move. What does this result show about the forces on the rope?

**Choices:**
  - A. The forces were balanced, so the rope did not change position.
  - B. There were no forces acting on the rope because it stayed still.
  - C. Team A's force was stronger but cancelled out by friction.
  - D. The rope was too heavy for the students to move.

**Correct:** A

**Explanation:** When two equal forces pull in opposite directions, they balance each other and the object's motion does not change. The rope stayed still because 300 N east and 300 N west cancelled out.

**Region:** none

**Verifier:** pass (conf 0.98) · agreed=true · tek=aligned · science=true

**Judge:** pass (conf 0.95) reasons=[]

**Scenario context (truncated):** Ms. Rodriguez's fifth grade class conducted a tug-of-war investigation on the playground to study forces. In the first round, Team A had three students pulling the rope east with a combined force of 3…

---

## Question 3 — 5.9A — Earth & Space
*pick reason: strand: Earth & Space*

**Stem:** The students wondered why the flagpole's shadow changed direction from west in the morning to east in the afternoon, even though the flagpole did not move. What is the best explanation for this change?

**Choices:**
  - A. Earth rotates on its axis, which makes the Sun appear to move across the sky from east to west.
  - B. The Sun actually travels around Earth once each day, moving from east to west.
  - C. The flagpole leans slightly in different directions as the day goes on.
  - D. Shadows always point toward the north no matter where the Sun is.

**Correct:** A

**Explanation:** Earth spins on its axis once about every 24 hours. As Earth rotates, the Sun appears to move across the sky, so shadows shift direction throughout the day.

**Region:** none

**Verifier:** pass (conf 1) · agreed=true · tek=aligned · science=true

**Judge:** pass (conf 0.95) reasons=[]

**Scenario context (truncated):** Ms. Rodriguez's fifth-grade class measured the shadow of their school flagpole at three different times on a sunny day in March. At 8:00 in the morning, the flagpole's shadow was 4 meters long and poi…

---

## Question 4 — 5.12A — Organisms & Environments
*pick reason: strand: Organisms & Environments*

**Stem:** Ms. Rodriguez's class noticed that frogs interact with both living and nonliving things at the pond. Which observation BEST shows frogs depending on a nonliving (abiotic) factor in their ecosystem?

**Choices:**
  - A. More frogs were seen when the air temperature was warmer
  - B. More insects were seen when frog numbers were high
  - C. Frogs were observed near the water's edge in September
  - D. Only 1 frog was counted during the December visit

**Correct:** A

**Explanation:** Temperature is an abiotic (nonliving) factor. The data shows frog activity rises with warmer air temperatures, which means frogs depend on this nonliving part of their ecosystem.

**Region:** none

**Verifier:** pass (conf 0.5) · agreed=null · tek=unsure · science=null

**Judge:** pass (conf 0.5) reasons=[]

**Scenario context (truncated):** Ms. Rodriguez's fifth grade class visits a local pond four times during the school year to observe frog activity. In September, they count 8 frogs near the water's edge and measure the air temperature…

---

## Question 5 — 5.6A — Matter & Energy
*pick reason: readiness: 5.6A*

**Stem:** After mixing, Ms. Rodriguez asked, 'Could you separate the rice from the beans again?' Which property of the materials would be MOST useful for separating them by hand?

**Choices:**
  - A. The mass of the bowl holding the mixture.
  - B. The size and color of the rice grains and beans.
  - C. The temperature of the room where the experiment took place.
  - D. The amount of time the students stirred the mixture.

**Correct:** B

**Explanation:** Because rice grains are small and white while beans are larger and black, students can use size and color to sort them apart. These properties did not change during mixing.

**Region:** none

**Verifier:** pass (conf 0.95) · agreed=true · tek=aligned · science=true

**Judge:** pass (conf 0.95) reasons=[]

**Scenario context (truncated):** Ms. Rodriguez asked her class to investigate what happens when two different materials are combined. Each student received one cup of white rice and one cup of black beans. The students poured both cu…

---

## Question 6 — 5.8C — Force, Motion & Energy
*pick reason: readiness: 5.8C*

**Stem:** The students saw the flagpole's shadow because light from the Sun was blocked by the pole. Which statement best describes how light behaves to create the shadow?

**Choices:**
  - A. Light travels in straight lines from the Sun and is blocked by the flagpole.
  - B. Light bends around the flagpole and lands behind it.
  - C. Light is just there in the air; it does not actually travel.
  - D. The flagpole pulls darkness toward the ground.

**Correct:** A

**Explanation:** Light from the Sun travels in straight lines. When the flagpole blocks those rays, the area behind the pole does not get light, which forms a shadow.

**Region:** none

**Verifier:** pass (conf 1) · agreed=true · tek=aligned · science=true

**Judge:** pass (conf 0.95) reasons=[]

**Scenario context (truncated):** Ms. Rodriguez's fifth-grade class measured the shadow of their school flagpole at three different times on a sunny day in March. At 8:00 in the morning, the flagpole's shadow was 4 meters long and poi…

---

## Question 7 — 5.10C — Earth & Space
*pick reason: readiness: 5.10C*

**Stem:** During the drought, the prairie soil dries out and becomes loose. If a strong North Texas thunderstorm finally arrives with heavy rain and wind, which Earth surface change is MOST likely to happen to the dry prairie?

**Choices:**
  - A. Wind and water will erode the loose, dry soil and carry it away.
  - B. The soil will instantly turn back into thick green grass overnight.
  - C. The soil will become heavier and sink deep into the ground.
  - D. The rain will wash the soil so it gains more mass than before.

**Correct:** A

**Explanation:** When soil is dry and loose, wind and heavy rain can easily erode it and carry it away. This is one way wind and water shape the land over time.

**Region:** dfw

**Verifier:** pass (conf 0.5) · agreed=null · tek=unsure · science=null

**Judge:** pass (conf 0.5) reasons=[]

**Scenario context (truncated):** Ms. Rodriguez's fifth grade class in Fort Worth is studying how organisms depend on their environment. The students observe a prairie ecosystem near their school where grasshoppers are common. The cla…

---

## Question 8 — 5.12A — Organisms & Environments
*pick reason: regionTag: hill_country*

**Stem:** Based on the scenario, which statement BEST describes how the Bracken Cave bats interact with biotic and abiotic factors in the Hill Country ecosystem?

**Choices:**
  - A. The bats depend on insects (biotic) for food and the cave (abiotic) for shelter.
  - B. The bats depend only on the cave walls and do not need other living things.
  - C. The bats make their own food inside the cave using sunlight.
  - D. The bats only interact with farmers and crops, not with other parts of nature.

**Correct:** A

**Explanation:** Bats are part of a healthy ecosystem because they depend on living things like insects (biotic) and nonliving things like the cave (abiotic) for survival.

**Region:** hill_country

**Verifier:** pass (conf 1) · agreed=true · tek=aligned · science=true

**Judge:** pass (conf 0.95) reasons=[]

**Scenario context (truncated):** Ms. Rodriguez's fifth grade class in Fredericksburg visited Bracken Cave in the Texas Hill Country. They learned that over 15 million Mexican free-tailed bats live in the cave during summer months. Ea…

---

## Question 9 — 5.12A — Organisms & Environments
*pick reason: regionTag: hill_country*

**Stem:** Ms. Rodriguez asked her students to predict what would MOST likely happen to mosquito populations near Fredericksburg if the Bracken Cave bat colony disappeared completely.

**Choices:**
  - A. Mosquito populations would increase because a major predator was removed.
  - B. Mosquito populations would decrease because mosquitoes need bats to survive.
  - C. Mosquito populations would stay exactly the same with no change.
  - D. Mosquitoes would disappear because only big animals are predators.

**Correct:** A

**Explanation:** Removing the bats removes a major predator of mosquitoes, so mosquito numbers would rise. The scenario notes one bat can eat up to 600 mosquitoes per hour.

**Region:** hill_country

**Verifier:** pass (conf 0.95) · agreed=true · tek=aligned · science=true

**Judge:** pass (conf 0.95) reasons=[]

**Scenario context (truncated):** Ms. Rodriguez's fifth grade class in Fredericksburg visited Bracken Cave in the Texas Hill Country. They learned that over 15 million Mexican free-tailed bats live in the cave during summer months. Ea…

---

## Question 10 — 5.12A — Organisms & Environments
*pick reason: lowest-verifier-confidence: 0.5*

**Stem:** Based on the class's data, what happens to frog activity at the pond as the seasons change from September to December?

**Choices:**
  - A. Frog activity decreases as the air temperature drops
  - B. Frog activity increases because frogs prefer cold water
  - C. Frog activity stays the same all year long
  - D. Frog activity decreases because the days get longer

**Correct:** A

**Explanation:** From September (28°C, 8 frogs) to December (6°C, 1 frog), temperature dropped and frog activity dropped too. Many frogs become inactive in cold weather to survive.

**Region:** none

**Verifier:** pass (conf 0.5) · agreed=null · tek=unsure · science=null

**Judge:** pass (conf 0.5) reasons=[]

**Scenario context (truncated):** Ms. Rodriguez's fifth grade class visits a local pond four times during the school year to observe frog activity. In September, they count 8 frogs near the water's edge and measure the air temperature…

---
