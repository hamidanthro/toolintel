#!/usr/bin/env node
/**
 * Texas Grade 8 social studies seed batch — OpenAI-only pipeline.
 *
 * Mirrors scripts/reading/run-seed-openai.js but for STAAR Grade 8
 * social studies (TEKS §113.20). Texas tests social studies at Grade 8
 * only; the scope is U.S. history 1763-1877 (Revolution → Reconstruction)
 * plus government/civics, geography, economics, and social-studies
 * skills. We generate informational stimulus passages + 5 cluster
 * questions, same shape as the reading pipeline.
 *
 * Sensitive-topic handling (locked):
 *   - Religion: factual mentions of Pilgrims, Puritans, religious
 *     freedom, the First Amendment OK. No theology, no "what
 *     Christians believe", no proselytizing.
 *   - Slavery: factual coverage of slavery, abolition, Civil War
 *     causes is REQUIRED for the period — but no graphic violence,
 *     no death scenes, no romanticization of "the South." Frame
 *     enslaved people as people, not labor units.
 *   - Civil War battles: factual (Antietam, Gettysburg) without
 *     gory detail; focus on outcome / strategy / human cost in
 *     civil-tone language.
 *   - Indigenous peoples: factual, named tribes (Comanche, Apache,
 *     Caddo) with specific land claims; do not flatten to "Native
 *     Americans" if a specific group is the actual subject.
 *
 * Usage:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     OPENAI_API_KEY=$(aws secretsmanager get-secret-value \
 *       --secret-id staar-tutor/openai-api-key \
 *       --region us-east-1 --query SecretString --output text) \
 *     node scripts/social-studies/run-seed-openai.js [--brief-id <id>] [--write]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Reuse the readability helper from the reading pipeline (already
// proven; handles word-count / FK / Lexile estimate).
const { getReadabilityReport } = require('../reading/lib/readability');

const STATE = 'texas';
const SUBJECT = 'social-studies';
const MODEL = 'gpt-4o';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 90000;

const PASSAGES_TABLE = 'staar-passages';
const POOL_TABLE = 'staar-content-pool';
const OUTPUT_DIR = path.resolve(__dirname, 'output');

// Texas Grade 8 social studies briefs covering TEKS §113.20 strands.
// Mix of US history (1763-1877), Texas history threads, government,
// geography, economics. ~14 briefs for v1.
const BRIEFS = [
  // US History — Revolutionary period
  { id: 'g8ss-stamp-act-protests', grade: '8', strand: 'us-history',
    topic: 'why colonists protested the Stamp Act of 1765 — what the tax was, why "no taxation without representation" became a rallying cry, and how the Sons of Liberty organized resistance' },
  { id: 'g8ss-declaration-key-ideas', grade: '8', strand: 'us-history',
    topic: "the three big ideas in the Declaration of Independence — natural rights, government by consent, and the right to alter or abolish a government — and where Jefferson got each idea" },
  { id: 'g8ss-shays-rebellion', grade: '8', strand: 'us-history',
    topic: "Shays' Rebellion of 1786-87 — the farmers' debt crisis in western Massachusetts, why the Articles of Confederation couldn't respond, and how it pushed states to call the Constitutional Convention" },

  // Constitution + Government
  { id: 'g8ss-constitutional-compromises', grade: '8', strand: 'government',
    topic: "the three big compromises at the Constitutional Convention — the Great Compromise (House + Senate), the Three-Fifths Compromise, and the slave trade compromise — and what each one did" },
  { id: 'g8ss-bill-of-rights-five', grade: '8', strand: 'government',
    topic: "five amendments in the Bill of Rights every Texas 8th grader should recognize — 1st (speech, religion, press, assembly), 2nd (arms), 4th (search and seizure), 5th (self-incrimination), 10th (powers reserved to the states)" },
  { id: 'g8ss-checks-and-balances', grade: '8', strand: 'government',
    topic: "how checks and balances work between the three branches — three concrete examples (presidential veto + congressional override; senate confirms judges; judicial review) and why the founders designed it this way" },

  // Westward expansion + Texas
  { id: 'g8ss-louisiana-purchase', grade: '8', strand: 'us-history',
    topic: "the Louisiana Purchase of 1803 — why Jefferson hesitated about its constitutionality, how it doubled the country's size, and what Lewis and Clark were sent to learn" },
  { id: 'g8ss-texas-revolution-causes', grade: '8', strand: 'texas-history',
    topic: 'three causes of the Texas Revolution (1835-36) — disagreements over slavery, the centralization of power under Santa Anna, and the size of the Anglo settler population — and how they combined' },
  { id: 'g8ss-trail-of-tears', grade: '8', strand: 'us-history',
    topic: 'the Trail of Tears (1830s) — the Indian Removal Act, the forced relocation of the Cherokee Nation, and the human cost of the journey from Georgia to Indian Territory' },

  // Civil War era
  { id: 'g8ss-missouri-compromise', grade: '8', strand: 'us-history',
    topic: 'the Missouri Compromise of 1820 — the slave-state / free-state balance, the 36°30′ line, and why it bought 30 years before sectional tension exploded again' },
  { id: 'g8ss-fugitive-slave-act', grade: '8', strand: 'us-history',
    topic: 'the Fugitive Slave Act of 1850 — what it required of Northern states, why it sharpened opposition to slavery in the North, and how it changed the Underground Railroad' },
  { id: 'g8ss-civil-war-economy-north-south', grade: '8', strand: 'economics',
    topic: 'how the economies of the North and South differed before the Civil War — industrial manufacturing in the North vs. cotton agriculture in the South — and why those differences shaped the war strategy' },
  { id: 'g8ss-emancipation-proclamation', grade: '8', strand: 'us-history',
    topic: 'the Emancipation Proclamation (1863) — what it did and did not do legally, why Lincoln framed it as a war measure, and how it changed the moral stakes of the war' },

  // Reconstruction
  { id: 'g8ss-reconstruction-amendments', grade: '8', strand: 'government',
    topic: 'the three Reconstruction Amendments (13th, 14th, 15th) — what each one did, the order they passed, and why they are sometimes called "the second founding"' },

  // ===========================================================
  // ----- K, 1, 2, 3 — practice-only — Texas-flavored basics -----
  // ===========================================================

  // Kindergarten (8)
  { id: 'gkss-my-family', grade: 'k', strand: 'community',
    topic: 'who lives in my family — naming family members (mom, dad, grandma, brother, sister) and what each person does to help' },
  { id: 'gkss-my-neighborhood', grade: 'k', strand: 'community',
    topic: 'what is in my neighborhood — house, school, park, store, fire station — and what each place is for' },
  { id: 'gkss-helpers-firefighters', grade: 'k', strand: 'community',
    topic: 'people who help us — firefighters, police officers, doctors, teachers — and one thing each one does' },
  { id: 'gkss-tx-flag-colors', grade: 'k', strand: 'texas-symbols',
    topic: 'the Texas flag is red, white, and blue with one big white star — that is why Texas is called the Lone Star State' },
  { id: 'gkss-tx-state-bird', grade: 'k', strand: 'texas-symbols',
    topic: 'the mockingbird is the Texas state bird — it can copy songs from other birds' },
  { id: 'gkss-tx-state-flower', grade: 'k', strand: 'texas-symbols',
    topic: 'the bluebonnet is the Texas state flower — it grows in spring and turns hills blue' },
  { id: 'gkss-day-night-week', grade: 'k', strand: 'time',
    topic: 'a week has seven days — Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday — and night and day make one full day' },
  { id: 'gkss-rules-classroom', grade: 'k', strand: 'civics',
    topic: 'why our classroom has rules — to keep us safe and to help everyone learn — naming three classroom rules' },

  // Grade 1 (8)
  { id: 'g1ss-tx-flag-history', grade: '1', strand: 'texas-symbols',
    topic: 'the story of the Texas flag — when it was made, what each color means (red for bravery, white for purity, blue for loyalty), and the lone star' },
  { id: 'g1ss-tx-on-the-map', grade: '1', strand: 'geography',
    topic: 'where Texas is on a map of the United States — Texas is in the south, touches Mexico, and has the Gulf of Mexico on its east side' },
  { id: 'g1ss-tx-cities-three', grade: '1', strand: 'geography',
    topic: 'three big Texas cities a first-grader should know — Austin (the capital), Houston (the biggest), and Dallas — and what each one is famous for' },
  { id: 'g1ss-needs-vs-wants', grade: '1', strand: 'economics',
    topic: 'needs are things we must have to live (food, water, shelter, clothes) and wants are things we like but do not need (toys, candy) — telling them apart' },
  { id: 'g1ss-jobs-people-do', grade: '1', strand: 'economics',
    topic: 'three jobs people do in a Texas town — farmer (grows food), nurse (helps sick people), bus driver (takes kids to school) — and how each helps everyone' },
  { id: 'g1ss-leaders-mayor', grade: '1', strand: 'civics',
    topic: 'a mayor is the leader of a city — the mayor helps make rules, fixes streets, and listens to the people who live there' },
  { id: 'g1ss-past-vs-present', grade: '1', strand: 'history',
    topic: 'how things used to be different — long ago people rode horses instead of cars, washed clothes by hand, and lit lamps with fire — now we have cars, washing machines, and electric lights' },
  { id: 'g1ss-state-and-country', grade: '1', strand: 'geography',
    topic: 'Texas is one of fifty states in the United States — a state is a piece of a country, and our country is the United States of America' },

  // Grade 2 (8)
  { id: 'g2ss-stephen-f-austin', grade: '2', strand: 'texas-history',
    topic: 'Stephen F. Austin was called the Father of Texas because he helped 300 families settle in Texas in the 1820s — Austin, the state capital, is named after him' },
  { id: 'g2ss-sam-houston-hero', grade: '2', strand: 'texas-history',
    topic: 'Sam Houston was a general and the first president of the Republic of Texas — he led Texas to freedom from Mexico, and Houston, the largest city in Texas, is named after him' },
  { id: 'g2ss-tx-six-flags', grade: '2', strand: 'texas-history',
    topic: 'the six flags that have flown over Texas (Spain, France, Mexico, Republic of Texas, Confederate States, United States) and why Texas has had so many — different countries ruled at different times' },
  { id: 'g2ss-tx-three-regions', grade: '2', strand: 'geography',
    topic: 'three major regions of Texas a second-grader can name — the Coastal Plains in the east, the Hill Country in the center, the Mountains and Basins in the west — and one fact about each' },
  { id: 'g2ss-tx-rivers-brazos', grade: '2', strand: 'geography',
    topic: 'three Texas rivers — the Rio Grande (border with Mexico), the Brazos (longest river inside Texas), and the Colorado (runs through Austin) — and why rivers matter for cities and farms' },
  { id: 'g2ss-goods-and-services', grade: '2', strand: 'economics',
    topic: 'goods are things you can hold (apples, books, toys) and services are jobs people do for others (cutting hair, fixing cars, teaching) — telling them apart with examples' },
  { id: 'g2ss-tx-laws-keep-safe', grade: '2', strand: 'civics',
    topic: 'why we have laws in Texas — to keep people safe, to settle problems fairly, and to protect things — three example laws (stop at red lights, no littering, school is for kids age 6+)' },
  { id: 'g2ss-cattle-cowboys-job', grade: '2', strand: 'texas-history',
    topic: 'why cowboys were so important in early Texas — they took care of cattle, drove herds north on long trails, and the cattle business made Texas grow' },

  // Grade 3 (8)
  { id: 'g3ss-tx-native-tribes', grade: '3', strand: 'texas-history',
    topic: 'three Native American groups who lived in Texas — the Comanche (Plains, horsemen), the Caddo (East Texas, farmers), and the Apache (West Texas, nomadic) — and how each used the land' },
  { id: 'g3ss-tx-spanish-mission', grade: '3', strand: 'texas-history',
    topic: 'Spanish missions in Texas — what a mission was (a church + town built by Spanish priests in the 1700s), why the Alamo started as a mission, and how missions tried to teach the Native peoples' },
  { id: 'g3ss-tx-alamo-fight', grade: '3', strand: 'texas-history',
    topic: 'the Alamo (1836) — what happened during the 13-day siege in San Antonio, why "Remember the Alamo!" became a rallying cry, and how the Alamo became a symbol of Texas courage' },
  { id: 'g3ss-tx-state-symbols-six', grade: '3', strand: 'texas-symbols',
    topic: 'six Texas state symbols — flower (bluebonnet), bird (mockingbird), tree (pecan), large mammal (Texas longhorn), small mammal (armadillo), motto ("Friendship") — and why each was chosen' },
  { id: 'g3ss-tx-economy-oil-cattle', grade: '3', strand: 'economics',
    topic: 'two of the biggest industries in Texas — cattle ranching (raising cows for beef and milk) and oil (drilling for fuel that powers cars and factories) — and where each happens in the state' },
  { id: 'g3ss-us-government-three-branches', grade: '3', strand: 'civics',
    topic: 'the three branches of government in the United States — Legislative (Congress, makes laws), Executive (President, runs the country), Judicial (Supreme Court, decides what laws mean) — at a third-grade level' },
  { id: 'g3ss-tx-capital-austin-government', grade: '3', strand: 'civics',
    topic: 'Austin is the capital of Texas — the Texas Capitol building stands on a hill, the Governor lives nearby, and the state legislature meets there to make Texas laws' },
  { id: 'g3ss-tx-mexican-heritage', grade: '3', strand: 'community',
    topic: "Texas's Mexican heritage — many Texans speak both Spanish and English; food (tacos, fajitas, enchiladas) and music (Tejano, mariachi) come from Mexican traditions; this heritage is part of what makes Texas Texas" },

  // ===========================================================
  // ----- K-3 v2 depth — eight more briefs per grade so the NO-REPEAT
  //       cycle for K-3 social studies extends from ~2 weeks to ~5 weeks.
  // ===========================================================

  // Kindergarten v2 (8) — calendar, school, helpers, money basics
  { id: 'gkss-school-day', grade: 'k', strand: 'community',
    topic: 'what we do at school each day — circle time, learning letters and numbers, snack, recess, art, and going home — naming three things kids do at school' },
  { id: 'gkss-four-seasons', grade: 'k', strand: 'time',
    topic: 'the four seasons in Texas — spring (flowers grow), summer (hot days), fall (leaves change), winter (cold mornings) — and one thing kids do in each season' },
  { id: 'gkss-jobs-at-school', grade: 'k', strand: 'community',
    topic: 'people who work at school — teacher (helps you learn), principal (leader of the school), nurse (helps you feel better), bus driver (drives the bus), cafeteria helper (serves lunch) — and one thing each one does' },
  { id: 'gkss-tx-state-tree', grade: 'k', strand: 'texas-symbols',
    topic: 'the pecan is the Texas state tree — pecans are nuts that grow inside green shells, and many Texas families bake pecan pie' },
  { id: 'gkss-money-coins', grade: 'k', strand: 'economics',
    topic: 'money is what we use to buy things — a penny is one cent, a nickel is five cents, a dime is ten cents — coins are small and round' },
  { id: 'gkss-my-address', grade: 'k', strand: 'community',
    topic: 'an address tells where you live — a number, the street name, the city, and the state — and why a kindergartener should know their address' },
  { id: 'gkss-tx-state-mammal', grade: 'k', strand: 'texas-symbols',
    topic: 'the armadillo is a Texas state animal — it has a hard shell and curls up when scared, and it lives in fields and woods all over Texas' },
  { id: 'gkss-helpers-doctors-nurses', grade: 'k', strand: 'community',
    topic: 'doctors and nurses help us when we are sick — they listen to our hearts, give us medicine, and tell us how to get better — three things they do' },

  // ----- K v3 — eight more briefs -----
  { id: 'gkss-birthday-celebration', grade: 'k', strand: 'community',
    topic: 'how a family celebrates a birthday in Texas — making a cake, singing happy birthday, lighting candles, opening cards from grandparents — three special things that happen on a birthday' },
  { id: 'gkss-school-flag-routine', grade: 'k', strand: 'civics',
    topic: 'every school morning, kids stand and put their hand on their heart while saying the Pledge of Allegiance to the flag at the front of the room — explaining what we promise and why we say it' },
  { id: 'gkss-mail-carrier', grade: 'k', strand: 'community',
    topic: 'a mail carrier brings letters and packages to our house every day; they wear a special uniform and drive a small truck with mailboxes inside — explaining what they do and why mail still matters' },
  { id: 'gkss-stop-signs-safety', grade: 'k', strand: 'civics',
    topic: 'stop signs are red and have eight sides; they tell drivers to stop so kids and other cars can cross the street safely — three places where we see stop signs and why everyone obeys them' },
  { id: 'gkss-helping-at-home', grade: 'k', strand: 'community',
    topic: 'three jobs kids can do at home — making the bed, putting toys away, helping set the table — and why everyone in a family helps so the home stays nice' },
  { id: 'gkss-tx-cities-vs-ranch', grade: 'k', strand: 'geography',
    topic: 'in Texas some kids live in big cities like Houston with tall buildings and lots of people, and some kids live in the country with cows and big open land — telling apart a city and a country place' },
  { id: 'gkss-family-dinner', grade: 'k', strand: 'community',
    topic: 'why families in Texas often eat dinner together — to share their day, to eat home-cooked food like beans and rice or tacos, and to spend time together before bedtime' },
  { id: 'gkss-tx-state-seal', grade: 'k', strand: 'texas-symbols',
    topic: 'the Texas state seal is a round picture with a big white star, an oak branch on one side, and an olive branch on the other; it goes on important Texas papers' },

  // Grade 1 v2 (8) — US flag, leaders, maps directions, holidays, voting
  { id: 'g1ss-us-flag', grade: '1', strand: 'civics',
    topic: 'the United States flag has 13 stripes (one for each first colony) and 50 stars (one for each state) — the colors are red, white, and blue, and we say the Pledge of Allegiance to it' },
  { id: 'g1ss-president-leader', grade: '1', strand: 'civics',
    topic: 'the President is the leader of the United States — the President lives in the White House in Washington, D.C., signs laws, and helps make important decisions for the whole country' },
  { id: 'g1ss-map-directions', grade: '1', strand: 'geography',
    topic: 'maps use four main directions — North (up), South (down), East (right), West (left) — using a compass rose, and Texas is south of Oklahoma and east of New Mexico' },
  { id: 'g1ss-holidays-american', grade: '1', strand: 'history',
    topic: 'three American holidays first-graders know — Independence Day (July 4, when our country became free), Thanksgiving (November, for being thankful), and Memorial Day (May, for soldiers who served)' },
  { id: 'g1ss-voting-basics', grade: '1', strand: 'civics',
    topic: 'voting is how grown-ups choose leaders — each person gets one vote, the person with the most votes wins, and Americans vote for the President every four years' },
  { id: 'g1ss-tx-rivers-simple', grade: '1', strand: 'geography',
    topic: 'three Texas rivers a first-grader can name — the Rio Grande (along the border with Mexico), the Brazos (a long river in central Texas), and the Trinity (runs near Dallas) — rivers give us water and let boats travel' },
  { id: 'g1ss-tx-songs-symbols', grade: '1', strand: 'texas-symbols',
    topic: 'Texas has its own state song called "Texas, Our Texas" — it talks about how big and beautiful Texas is, and Texas kids learn to sing it in school' },
  { id: 'g1ss-school-then-now', grade: '1', strand: 'history',
    topic: 'school long ago vs school today — kids used chalk and slates instead of pencils and paper, sat in one-room schools with all grades together, and walked to school instead of taking a bus' },

  // ----- G1 v3 — eight more briefs -----
  { id: 'g1ss-tx-independence-day', grade: '1', strand: 'texas-history',
    topic: 'March 2 is Texas Independence Day — the day in 1836 when Texas signed a paper saying it was free from Mexico; some Texas schools have special activities to celebrate' },
  { id: 'g1ss-volunteers-community', grade: '1', strand: 'civics',
    topic: 'volunteers are people who help others without getting paid — examples include reading to younger kids at the library, sorting cans at a Texas food pantry, or picking up trash at a park; how volunteering helps a community' },
  { id: 'g1ss-recycling-earth', grade: '1', strand: 'community',
    topic: 'recycling means putting cans, bottles, and paper into special bins so they can be made into new things instead of going in the trash; how Texas towns pick up recycling and why it helps the earth' },
  { id: 'g1ss-rules-consequences', grade: '1', strand: 'civics',
    topic: 'rules tell us what to do and what not to do; when people break rules there are consequences — examples in a classroom (no recess if you push), at home (no dessert if you do not eat dinner), and in the city (police give tickets for speeding)' },
  { id: 'g1ss-city-hall', grade: '1', strand: 'civics',
    topic: 'city hall is the building where the mayor and city workers do their jobs — they pay for parks, fix roads, and run the fire department; many Texas city halls are old brick buildings in the middle of downtown' },
  { id: 'g1ss-public-school-free', grade: '1', strand: 'civics',
    topic: 'in Texas every kid can go to public school for free — taxes that grown-ups pay to the state cover teachers, books, and buses, so families do not have to pay to send their kids to school' },
  { id: 'g1ss-tx-mockingbird-songs', grade: '1', strand: 'texas-symbols',
    topic: 'the mockingbird is the Texas state bird; it can copy songs from other birds and even from car alarms and phone rings; it sings most loudly in spring when it is looking for a partner' },
  { id: 'g1ss-tx-traditional-foods', grade: '1', strand: 'community',
    topic: 'three traditional Texas foods that come from different cultures — barbecue (English and German settlers), tamales (Mexican heritage), and kolaches (Czech immigrants in Central Texas) — and how each is a part of Texas today' },

  // Grade 2 v2 (8) — Texas heroes, products, immigration, weather, taxes basic
  { id: 'g2ss-davy-crockett', grade: '2', strand: 'texas-history',
    topic: 'Davy Crockett was a frontiersman from Tennessee who came to Texas to help fight for independence — he died defending the Alamo in 1836 and is remembered as a hero of Texas' },
  { id: 'g2ss-juan-seguin', grade: '2', strand: 'texas-history',
    topic: 'Juan Seguín was a Tejano (a Texan of Mexican heritage) who fought beside Sam Houston for Texas independence — he later became mayor of San Antonio, showing that Texans of many backgrounds helped build Texas' },
  { id: 'g2ss-tx-products-three', grade: '2', strand: 'economics',
    topic: 'three things Texas is famous for producing — beef cattle (more than any other state), oil (used for fuel), and cotton (made into clothes) — and why each grew up in Texas' },
  { id: 'g2ss-tx-weather-climate', grade: '2', strand: 'geography',
    topic: 'weather across Texas is different in different places — the east is wet and humid, the west is dry, summers are hot statewide, and the north sometimes has snow in winter' },
  { id: 'g2ss-immigration-tx', grade: '2', strand: 'community',
    topic: 'people from many countries came to live in Texas — German families settled in Fredericksburg, Czech families in West (yes, that is the town name), Mexican families across South Texas — and each group brought food, music, and stories' },
  { id: 'g2ss-taxes-simple', grade: '2', strand: 'economics',
    topic: 'taxes are money people pay to the government — taxes pay for roads, schools, parks, firefighters, and police — when grown-ups buy things, a small extra amount called sales tax goes to Texas' },
  { id: 'g2ss-tx-state-fair', grade: '2', strand: 'community',
    topic: 'the State Fair of Texas happens every fall in Dallas — Big Tex (a 55-foot-tall talking cowboy) welcomes everyone, and people come to see animals, ride rides, and try new foods' },
  { id: 'g2ss-tx-state-pledge', grade: '2', strand: 'civics',
    topic: 'the Texas Pledge — Texas kids say it after the Pledge of Allegiance: "Honor the Texas flag; I pledge allegiance to thee, Texas, one state under God, one and indivisible" — and what each part means' },

  // ----- G2 v3 — six more briefs -----
  { id: 'g2ss-tx-state-symbols-extra', grade: '2', strand: 'texas-symbols',
    topic: 'three more Texas state symbols a second-grader should know — the state insect (monarch butterfly), the state flying mammal (Mexican free-tailed bat), and the state plant (prickly pear cactus) — and one fact about each' },
  { id: 'g2ss-tx-three-cultures-shared', grade: '2', strand: 'community',
    topic: 'three cultures that helped shape today\'s Texas — Native American (Caddo, Comanche, others lived here first), Spanish/Mexican (settlers built missions and brought language and food), and Anglo-American (settlers came in the 1820s) — and one thing each gave to Texas' },
  { id: 'g2ss-railroads-changed-tx', grade: '2', strand: 'texas-history',
    topic: "how trains changed Texas in the 1870s and 1880s — before trains, people moved by wagon and cattle by long drives; trains let Texas farms send food and cattle east in days, helped cities like Houston and Dallas grow, and brought new settlers" },
  { id: 'g2ss-tx-money-history', grade: '2', strand: 'economics',
    topic: 'how Texans paid for things over time — Native peoples traded with each other (no money), Spanish settlers used silver coins, the Republic of Texas printed paper money called "redbacks", and today Texans use U.S. dollars and cards' },
  { id: 'g2ss-tx-mission-trail', grade: '2', strand: 'texas-history',
    topic: 'the San Antonio mission trail has five Spanish missions in a row, including Mission San José and the Alamo; Spanish priests built them in the 1700s as churches and small towns where they tried to teach Native peoples' },
  { id: 'g2ss-tx-state-government-three', grade: '2', strand: 'civics',
    topic: 'the three parts of Texas state government — the Governor (lives in Austin and runs the state), the Legislature (group of people who make state laws), and the Texas Supreme Court (decides what the laws mean) — and where each one meets' },

  // Grade 3 v2 (8) — more tribes, San Jacinto, Texas Rangers, railroads, Tejano detail
  { id: 'g3ss-tx-tribes-tonkawa-wichita', grade: '3', strand: 'texas-history',
    topic: 'two more Native American groups of Texas — the Tonkawa (Central Texas, hunters and gatherers) and the Wichita (North Texas, farmers who built grass houses called grass lodges) — and how each used the land' },
  { id: 'g3ss-san-jacinto-battle', grade: '3', strand: 'texas-history',
    topic: 'the Battle of San Jacinto (April 21, 1836) — Sam Houston led the Texas army to a surprise victory over Mexico in just 18 minutes, capturing Santa Anna and winning Texas independence' },
  { id: 'g3ss-texas-rangers-history', grade: '3', strand: 'texas-history',
    topic: 'the Texas Rangers are a famous law-enforcement group started in 1823 by Stephen F. Austin to protect settlers — they still work today, helping solve big crimes across Texas' },
  { id: 'g3ss-tx-railroads-growth', grade: '3', strand: 'texas-history',
    topic: 'how railroads changed Texas in the late 1800s — trains let cattle ranchers ship beef to other states, brought new settlers, and helped cities like Houston, Dallas, and Fort Worth grow big' },
  { id: 'g3ss-tejano-culture-detail', grade: '3', strand: 'community',
    topic: 'Tejano culture in South Texas — Tejanos are Texans of Mexican heritage who have lived in Texas for generations; their music (accordion-led conjunto), food (carne asada, breakfast tacos), and Spanish language shaped Texas' },
  { id: 'g3ss-tx-supply-and-demand', grade: '3', strand: 'economics',
    topic: 'how prices work — supply (how much of something there is) and demand (how much people want it) — when there is little supply but big demand, prices go up; when there is lots of supply but small demand, prices go down (with kid-level examples)' },
  { id: 'g3ss-tx-galveston-port', grade: '3', strand: 'geography',
    topic: 'Galveston is a port city on the Gulf of Mexico — for most of the 1800s it was the biggest city in Texas because ships could load and unload there, until a giant hurricane in 1900 changed everything' },
  { id: 'g3ss-tx-juneteenth-history', grade: '3', strand: 'texas-history',
    topic: 'Juneteenth started in Galveston, Texas on June 19, 1865 — the day enslaved Texans learned they were free; Texas was the first state to make Juneteenth a holiday, and now it is a U.S. national holiday' },

  // ----- G3 v3 — eight more briefs -----
  { id: 'g3ss-tx-spindletop-oil', grade: '3', strand: 'texas-history',
    topic: 'Spindletop was an oil discovery near Beaumont, Texas on January 10, 1901 — a giant geyser of oil shot up nine days, changed Texas forever, and started the Texas oil industry that still exists today' },
  { id: 'g3ss-tx-1876-constitution', grade: '3', strand: 'civics',
    topic: 'the Texas Constitution of 1876 is the rule book for the state — it sets up how Texas is run, lists the rights of Texans, and limits how the state government can spend money; it is one of the longest state constitutions in the country' },
  { id: 'g3ss-tx-cattle-drives-chisholm', grade: '3', strand: 'texas-history',
    topic: 'after the Civil War, cowboys drove millions of Texas longhorn cattle north along the Chisholm Trail to Kansas, where the cows were loaded onto trains for cities back east; the trail drives lasted from about 1867 to 1885' },
  { id: 'g3ss-tx-civil-war-period', grade: '3', strand: 'texas-history',
    topic: 'Texas was part of the Confederate States during the Civil War (1861-1865); after the war, Texas had to rejoin the United States, and the Reconstruction period brought big changes like the end of slavery and new rights for freed Black Texans' },
  { id: 'g3ss-lbj-tx-president', grade: '3', strand: 'texas-history',
    topic: 'Lyndon B. Johnson was born in Stonewall, Texas in 1908; he became the 36th President of the United States in 1963; he signed important laws about civil rights and started programs to help schools and elderly people' },
  { id: 'g3ss-tx-modern-tech-economy', grade: '3', strand: 'economics',
    topic: 'modern Texas has a big technology industry — companies like Dell (started by a UT student in his Austin dorm room), Texas Instruments, and many others build computers, phones, and software; tech companies bring lots of jobs to Austin and Dallas' },
  { id: 'g3ss-tx-immigration-stories', grade: '3', strand: 'community',
    topic: 'people from many countries came to Texas over the years — Mexican families crossed the Rio Grande, German families settled in the Hill Country (Fredericksburg, New Braunfels), Czech families settled in Central Texas, and Vietnamese families came after the Vietnam War; each group brought new food, language, and traditions' },
  { id: 'g3ss-tx-austin-as-capital', grade: '3', strand: 'civics',
    topic: 'Austin became the capital of Texas in 1839 when it was a small frontier town named after Stephen F. Austin; the Texas legislature meets there to pass laws, the Governor lives in the Governor\'s Mansion, and the pink-granite Texas Capitol stands at the heart of downtown' },

  // ===========================================================
  // ----- Grade 4 (TEKS §113.15) — Texas regions, history, government -----
  // ===========================================================
  { id: 'g4ss-tx-four-regions', grade: '4', strand: 'geography',
    topic: 'the four major regions of Texas — Coastal Plains (east), North Central Plains (central), Great Plains (north), Mountains and Basins (west) — landforms, climate, and one major city in each' },
  { id: 'g4ss-tx-native-detail', grade: '4', strand: 'texas-history',
    topic: 'three Native American groups of Texas in detail — Caddo (East Texas farmers, mound-builders), Comanche (Plains horsemen, lords of the southern plains), and Karankawa (Gulf Coast, fishermen) — and how each used their region' },
  { id: 'g4ss-tx-spanish-exploration', grade: '4', strand: 'texas-history',
    topic: 'Spanish exploration of Texas — Cabeza de Vaca (1528 shipwreck and journey across Texas), Coronado (search for cities of gold), and the Spanish missions later established to teach Native peoples and claim the land' },
  { id: 'g4ss-tx-mexican-period', grade: '4', strand: 'texas-history',
    topic: 'Texas under Mexican rule (1821-1836) — why Mexico invited American settlers, the empresario system, Stephen F. Austin and the "Old Three Hundred" colonists, and the tensions that grew with Mexican government' },
  { id: 'g4ss-tx-revolution-events', grade: '4', strand: 'texas-history',
    topic: 'four key events of the Texas Revolution (1835-1836) — the Battle of Gonzales ("Come and Take It"), the Alamo, the Goliad massacre, and the Battle of San Jacinto where Texas won independence' },
  { id: 'g4ss-tx-statehood-1845', grade: '4', strand: 'texas-history',
    topic: 'Texas joining the United States in 1845 — why the Republic of Texas wanted statehood, the slavery debate that delayed it, and how annexation led to the Mexican-American War' },
  { id: 'g4ss-tx-three-branches', grade: '4', strand: 'civics',
    topic: 'the three branches of Texas state government — Legislative (state legislature, makes laws), Executive (Governor, runs the state), Judicial (Texas Supreme Court, interprets state laws) — and where each meets in Austin' },
  { id: 'g4ss-tx-economy-modern', grade: '4', strand: 'economics',
    topic: "Texas's modern economy — the major industries (oil and gas, technology, agriculture, healthcare, aerospace) and why Texas has the second-largest state economy in the country" },

  // ===========================================================
  // ----- Grade 5 (TEKS §113.16) — US history overview -----
  // ===========================================================
  { id: 'g5ss-pre-columbian', grade: '5', strand: 'us-history',
    topic: 'Native American civilizations before European contact — three examples (the Aztec/Mexica empire in Mexico, the Mississippian mound-builders in the southeast, the Pueblo peoples in the southwest) and the diversity of peoples already in the Americas' },
  { id: 'g5ss-13-colonies-three-regions', grade: '5', strand: 'us-history',
    topic: 'the 13 American colonies in three regions — New England (subsistence farming, fishing, shipbuilding), Middle (grain, religious tolerance), Southern (plantation agriculture, slavery) — and how each region developed differently' },
  { id: 'g5ss-revolutionary-war-causes', grade: '5', strand: 'us-history',
    topic: "the causes of the American Revolution — British taxation without representation (Stamp Act, Tea Act), the Boston Massacre, the Boston Tea Party, and the colonists' decision to declare independence in 1776" },
  { id: 'g5ss-constitution-bill-of-rights', grade: '5', strand: 'civics',
    topic: 'the U.S. Constitution and Bill of Rights — why the founders replaced the Articles of Confederation with the Constitution, the three branches of government, and the first ten amendments protecting individual rights' },
  { id: 'g5ss-civil-war-overview', grade: '5', strand: 'us-history',
    topic: "the Civil War (1861-1865) — the slavery question, North vs South, key figures (Lincoln, Lee, Grant), the Emancipation Proclamation, and how the war ended at Appomattox" },
  { id: 'g5ss-industrial-revolution-us', grade: '5', strand: 'economics',
    topic: 'the Industrial Revolution in the United States (1800s) — railroads, steel, factories, immigration, urbanization, and how these changes transformed daily life' },
  { id: 'g5ss-civil-rights-movement', grade: '5', strand: 'us-history',
    topic: "the Civil Rights movement (1950s-1960s) — Rosa Parks and the Montgomery Bus Boycott, Dr. Martin Luther King Jr.'s leadership, the Civil Rights Act of 1964, and the long struggle for equality" },
  { id: 'g5ss-fifty-states-regions', grade: '5', strand: 'geography',
    topic: 'the five regions of the United States — Northeast, Southeast, Midwest, Southwest, West — and a defining geographic feature of each (Appalachian Mountains, Mississippi River, Great Plains, Rocky Mountains, Pacific coast)' },

  // ===========================================================
  // ----- Grade 6 (TEKS §113.18) — World cultures + geography -----
  // ===========================================================
  { id: 'g6ss-mesopotamia-civilization', grade: '6', strand: 'world-history',
    topic: 'ancient Mesopotamia — between the Tigris and Euphrates rivers, the rise of city-states (Ur, Babylon), the invention of cuneiform writing, and why Mesopotamia is called the "cradle of civilization"' },
  { id: 'g6ss-ancient-egypt', grade: '6', strand: 'world-history',
    topic: 'ancient Egypt — the Nile River as the source of life, pharaohs and pyramids, hieroglyphics, and the trade and innovation that made Egypt one of the longest-lasting civilizations in history' },
  { id: 'g6ss-ancient-greece-democracy', grade: '6', strand: 'world-history',
    topic: 'ancient Greece — Athens and Sparta, the birth of democracy in Athens, philosophy (Socrates, Plato, Aristotle), and how Greek ideas still shape modern government and thought' },
  { id: 'g6ss-rome-republic-empire', grade: '6', strand: 'world-history',
    topic: 'the Roman Republic and Empire — the shift from republic to empire under Caesar, Roman engineering (aqueducts, roads), Roman law as a foundation of modern legal systems' },
  { id: 'g6ss-cultural-regions-latin-america', grade: '6', strand: 'world-cultures',
    topic: 'Latin America today — Spanish and Portuguese colonial heritage, indigenous influences (Maya, Inca, Aztec descendants), shared languages, and the geographic range from Mexico through South America' },
  { id: 'g6ss-cultural-regions-africa', grade: '6', strand: 'world-cultures',
    topic: 'Sub-Saharan Africa today — major regions (Sahel, East Africa, West Africa, Southern Africa), a few key facts (most populous country: Nigeria; longest river: Nile flows north; second-largest desert: Sahara just north), and how colonial borders still shape modern countries' },
  { id: 'g6ss-government-types-three', grade: '6', strand: 'civics',
    topic: 'three types of government — democracy (people elect leaders, like the US), monarchy (one ruler, like the UK constitutional monarchy), and dictatorship (one ruler with no checks) — and how each structures power' },
  { id: 'g6ss-trade-economic-systems', grade: '6', strand: 'economics',
    topic: 'three economic systems — market (free enterprise, like the US), command (government-controlled, like North Korea), and mixed (most modern democracies) — and how each balances government and individual choice' },

  // ===========================================================
  // ----- Grade 7 (TEKS §113.19) — Texas history detail -----
  // ===========================================================
  { id: 'g7ss-tx-spanish-colonial-era', grade: '7', strand: 'texas-history',
    topic: "the Spanish colonial era in Texas (1690-1821) — the founding of Spanish missions (San Antonio, Goliad, Nacogdoches), the role of presidios (military forts), and the slow Spanish settlement of the territory they called Tejas" },
  { id: 'g7ss-tx-empresario-system', grade: '7', strand: 'texas-history',
    topic: 'the empresario system in Mexican Texas — Mexico granted land to American settlers in exchange for population and loyalty, Stephen F. Austin and the "Old Three Hundred", the cultural mixing that resulted, and the tensions that built into revolution' },
  { id: 'g7ss-tx-runaway-scrape', grade: '7', strand: 'texas-history',
    topic: 'the Runaway Scrape of 1836 — the panicked retreat of Texas families east as Santa Anna advanced after the Alamo and Goliad, the hardships of the journey, and how Sam Houston used the time to train his army for San Jacinto' },
  { id: 'g7ss-tx-republic-challenges', grade: '7', strand: 'texas-history',
    topic: "the Republic of Texas (1836-1845) — its severe debt problem, two presidencies (Houston twice, Lamar between), conflicts with Comanche raiders, the unsuccessful Santa Fe Expedition, and why most Texans wanted statehood" },
  { id: 'g7ss-tx-after-civil-war', grade: '7', strand: 'texas-history',
    topic: "Texas after the Civil War (1865-1876) — the abolition of slavery (Juneteenth, June 19, 1865), Reconstruction politics, the Constitution of 1876 (which still governs Texas), and the rebuilding of the state's economy" },
  { id: 'g7ss-tx-cattle-kingdom', grade: '7', strand: 'texas-history',
    topic: 'the Cattle Kingdom era (1866-1890) — the longhorn cattle drives north along the Chisholm and Goodnight-Loving trails, the rise of cowboy culture, and how barbed wire and the railroad eventually ended the open range' },
  { id: 'g7ss-tx-spindletop-oil', grade: '7', strand: 'texas-history',
    topic: 'Spindletop and the start of the Texas oil boom (1901) — the Lucas Gusher near Beaumont, the boom towns that followed, the founding of major oil companies (Texaco, Gulf, Humble) that grew from this discovery, and how oil reshaped Texas' },
  { id: 'g7ss-tx-modern-economy', grade: '7', strand: 'economics',
    topic: "Texas's transition from oil-and-cattle to a diversified modern economy — the rise of technology (Dell, Silicon Hills in Austin), aerospace (NASA Johnson Space Center, military bases), healthcare (Texas Medical Center in Houston), and renewable energy (the largest wind power capacity of any state)" },

  // ---- Round 2 (Q phase): Texas-history depth + missing US strands ----

  // More Texas history (5)
  { id: 'g8ss-tx-republic-years', grade: '8', strand: 'texas-history',
    topic: 'the Republic of Texas (1836-1845) — its currency, two capitals (Houston then Austin), the diplomatic recognition challenge, and why it eventually pursued statehood' },
  { id: 'g8ss-tx-san-jacinto', grade: '8', strand: 'texas-history',
    topic: "the Battle of San Jacinto (April 21, 1836) — the surprise attack, Houston's strategy, the 18-minute fight, and the Treaty of Velasco that followed" },
  { id: 'g8ss-tx-annexation-1845', grade: '8', strand: 'texas-history',
    topic: 'the annexation of Texas in 1845 — why the U.S. hesitated for nine years, the slavery balance argument, and how the Joint Resolution finally brought Texas into the Union' },
  { id: 'g8ss-tx-civil-war-secession', grade: '8', strand: 'texas-history',
    topic: "Texas in the Civil War — Sam Houston's stand against secession, Texas's role as a Confederate state, and the late conflict at Palmito Ranch (May 1865) after Lee's surrender" },
  { id: 'g8ss-tx-reconstruction-state', grade: '8', strand: 'texas-history',
    topic: 'Texas during Reconstruction (1865-1873) — the new 1869 state constitution, the role of Freedmen, and why federal occupation ended in 1870' },

  // More US history (6)
  { id: 'g8ss-french-indian-war', grade: '8', strand: 'us-history',
    topic: "the French and Indian War (1754-1763) — the global Seven Years' War context, why Britain won North America, and how the war's costs led to colonial taxation" },
  { id: 'g8ss-boston-tea-party', grade: '8', strand: 'us-history',
    topic: 'the Boston Tea Party (December 1773) — the Tea Act dispute, the actual event, and the Coercive (Intolerable) Acts that followed' },
  { id: 'g8ss-articles-of-confederation-weaknesses', grade: '8', strand: 'us-history',
    topic: "the Articles of Confederation — what powers they gave the federal government, three concrete weaknesses (no taxing power, no commerce regulation, unanimity required for amendment), and how Shays' Rebellion exposed the limits" },
  { id: 'g8ss-manifest-destiny', grade: '8', strand: 'us-history',
    topic: 'Manifest Destiny in the 1840s — the phrase, the cultural assumptions behind it, and how it justified U.S. westward expansion through war, treaty, and purchase' },
  { id: 'g8ss-mexican-american-war', grade: '8', strand: 'us-history',
    topic: 'the Mexican-American War (1846-1848) — the disputed border, the Treaty of Guadalupe Hidalgo, the Mexican Cession (CA, NV, UT, AZ, NM, parts of CO and WY), and how the Wilmot Proviso reignited the slavery debate' },
  { id: 'g8ss-civil-war-antietam-turning', grade: '8', strand: 'us-history',
    topic: 'the Battle of Antietam (September 17, 1862) — the bloodiest single day in U.S. history at the time, why Lincoln treated it as a Union victory, and how it cleared the political path for the Emancipation Proclamation' },

  // More government (3)
  { id: 'g8ss-federalist-anti-federalist', grade: '8', strand: 'government',
    topic: 'the ratification debate of 1787-88 — the Federalist position (Hamilton, Madison, Jay), the Anti-Federalist position (Henry, George Mason), and how the promise of a Bill of Rights closed the deal' },
  { id: 'g8ss-federalist-no-10', grade: '8', strand: 'government',
    topic: "Federalist No. 10 — Madison's argument that a large republic is the best defense against the dangers of factions, and how that idea shows up in U.S. government today" },
  { id: 'g8ss-northwest-ordinance', grade: '8', strand: 'government',
    topic: 'the Northwest Ordinance of 1787 — how new states join the Union, why it banned slavery in the Northwest Territory, and what it set as a precedent for later state admissions' },

  // More economics (2)
  { id: 'g8ss-cotton-gin-economy', grade: '8', strand: 'economics',
    topic: "Eli Whitney's cotton gin (1793) — how it sped up cotton processing, why it expanded enslaved labor instead of reducing it, and how it tied the South's economy to plantation cotton" },
  { id: 'g8ss-northern-industrial-revolution', grade: '8', strand: 'economics',
    topic: 'industrialization in the North (1820s-1860s) — the Lowell mill system, the wave of immigration that fed the factories, the rise of cities, and how this economy contrasted with the agricultural South' }
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
  const g = String(grade).toLowerCase();
  const earlyReader = ['k', '1', '2', '3'].includes(g);
  const middleGrade = ['4', '5', '6', '7'].includes(g);

  if (middleGrade) {
    const wordTarget = g === '4' ? '200-380' : g === '5' ? '240-440' : g === '6' ? '280-500' : '320-540';
    const scope = g === '4' ? 'Texas regions, Texas history through Republic + statehood, Texas government basics, Texas economy (TEKS §113.15)'
                : g === '5' ? 'US history overview — pre-Columbian through modern era, US geography (TEKS §113.16)'
                : g === '6' ? 'world cultures + world geography — ancient civilizations, regional cultures (Latin America, Africa, Asia, Europe), comparative government (TEKS §113.18)'
                : 'Texas history in detail — exploration, colonization, revolution, Republic, statehood, Civil War, cattle kingdom, oil era, modern Texas (TEKS §113.19)';
    return `You write social-studies passages for a Texas Grade ${grade} practice app, scoped to: ${scope}.

== Audience ==
${g === '4' ? '9-10' : g === '5' ? '10-11' : g === '6' ? '11-12' : '12-13'}-year-old students. Vocabulary at grade-${grade} level. Tier 2 academic vocabulary OK; selected Tier 3 with brief explanation.

== Sensitive-topic discipline (LOCKED) ==
- Religion: factual mentions OK (founders' beliefs, religious freedom, world religions as cultural fact). NEVER theology, prayer, "what believers believe", proselytizing.
- Slavery: factual coverage required where on-topic. Frame enslaved people as people. NO graphic violence.
- Wars/battles: factual; focus on causes, outcomes, human cost in civil-tone language.
- Indigenous peoples: name specific groups (Comanche, Caddo, Apache, Cherokee, Choctaw) with specific events and land.
- Politics: present multiple historical perspectives factually. No modern-political-party editorializing.

== Output format (STRICT JSON) ==
{
  "title": "Short topic-direct title",
  "body": "## Title\\n\\nFirst paragraph...\\n\\nSecond paragraph...",
  "topicNotes": "1-line internal note"
}

== Body format ==
- Markdown. Open with "## " + title. Each paragraph separated by single blank line.
- ${wordTarget} words. ${g === '4' ? '3-5' : g === '5' || g === '6' ? '4-6' : '5-7'} paragraphs.
- May use **bold** sparingly for Tier-3 vocabulary or named events / treaties.
- DO NOT include images, HTML tags, or inline paragraph numbers.

ONLY output valid JSON. No markdown fences, no preamble.`;
  }

  if (earlyReader) {
    return `You write social-studies passages for a Texas Grade ${grade} practice app. K-3 is practice-only (STAAR doesn't test SS until Grade 8). Topics: Texas state symbols, Texas heroes, Texas geography basics, communities, family, helpers, simple state history.

== Audience ==
${grade === 'k' ? '5-6-year-old' : grade === '1' ? '6-7-year-old' : grade === '2' ? '7-8-year-old' : '8-9-year-old'} students. Vocabulary at early-reader level (Tier 1 only — common everyday words). Sentences SHORT (avg ${grade === 'k' ? '5-7' : grade === '1' ? '6-9' : grade === '2' ? '7-11' : '8-13'} words; never more than ${grade === 'k' ? '11' : grade === '1' ? '13' : grade === '2' ? '15' : '17'}).

== Sensitive-topic discipline (LOCKED) ==
- NO violence, NO death scenes, NO complex conflict.
- Heroes framed in their kid-positive role (Stephen F. Austin = "the Father of Texas who helped families settle"; Sam Houston = "general and first president of the Republic of Texas").
- Texas history simplified — focus on people, places, symbols, jobs.
- Native peoples named factually with respect (Comanche, Caddo, Apache) when in topic.

== Output format (STRICT JSON) ==
{
  "title": "Short topic-direct title",
  "body": "## Title\\n\\nFirst paragraph...\\n\\nSecond paragraph...",
  "topicNotes": "1-line internal note"
}

== Body format ==
- Markdown. Open with "## " + title. Each paragraph separated by single blank line.
- ${grade === 'k' ? '50-130' : grade === '1' ? '80-180' : grade === '2' ? '120-260' : '180-320'} words. Match early-reader length.
- DO NOT include images, HTML tags, or inline paragraph numbers.

ONLY output valid JSON. No markdown fences, no preamble.`;
  }
  return `You write informational social-studies passages for a Texas STAAR Grade 8 practice app. Texas tests social studies at Grade 8 only, covering U.S. history 1763-1877 (Revolution through Reconstruction), the development of the U.S. Constitution and government structure, geography, economics of the period, and the place of Texas in U.S. history.

== Audience ==
13-14-year-old students. Vocabulary at grade-8 level (Tier 2 + selected Tier 3 academic vocabulary). Flesch-Kincaid 7.5-10.0 acceptable; informational social studies at this level naturally lands FK 8-12.

== Sensitive-topic discipline (LOCKED) ==
- Religion: factual mentions of Pilgrims, Puritans, religious freedom, First Amendment establishment + free-exercise clauses are REQUIRED for the period. NEVER theology, prayer, "what Christians/Jews/Muslims believe", proselytizing language.
- Slavery: factual coverage of slavery, abolition, the Civil War era is REQUIRED. Frame enslaved people as people. NO graphic violence, NO death scenes, NO romanticization of slavery or "the antebellum South."
- Civil War battles: factual (Antietam, Gettysburg) without gory detail; focus on strategy / outcome / human cost in civil-tone language.
- Indigenous peoples: factual, named tribes (Comanche, Apache, Caddo, Cherokee, Choctaw) with specific land claims and specific events. Don't flatten to "Native Americans" or "Indians" when a specific group is the subject.
- Politics: present multiple perspectives factually. Never editorialize about modern political parties.

== Output format (STRICT JSON) ==

{
  "title": "Short topic-direct title",
  "body": "## Title\\n\\nFirst paragraph...\\n\\nSecond paragraph...\\n\\n...",
  "topicNotes": "1-line internal note"
}

== Body format ==
- Markdown. Open with "## " + title. Each paragraph separated by single blank line.
- 450-700 words. Real STAAR Grade 8 social studies stimulus passages cluster around 500-650 words.
- Use **bold** sparingly for Tier-3 vocabulary or named treaties / acts (Stamp Act, Three-Fifths Compromise).
- May use ## section headings for multi-paragraph topics.
- DO NOT include images, HTML tags, or inline paragraph numbers.

== Strict-pass requirements ==
- Stay within Texas STAAR Grade 8 scope (US history 1763-1877, government, civics, geography, economics, Texas threads).
- Names of historical figures should be accurate (no fabricated quotes; if you're not 100% sure of a quote, paraphrase).
- Dates should be accurate within the year.
- Multiple perspectives where the historical record offers them — especially on slavery and Reconstruction.

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildPassageUser(brief) {
  const g = String(brief.grade).toLowerCase();
  const earlyReader = ['k', '1', '2', '3'].includes(g);
  const middleGrade = ['4', '5', '6', '7'].includes(g);
  const wordTarget = g === 'k' ? '50-130' : g === '1' ? '80-180' : g === '2' ? '120-260' : g === '3' ? '180-320'
                   : g === '4' ? '200-380' : g === '5' ? '240-440' : g === '6' ? '280-500' : g === '7' ? '320-540'
                   : '450-700';
  const para = earlyReader ? '2-3 paragraphs' : middleGrade ? '4-6 paragraphs' : '4-7 paragraphs';
  return `Generate ONE social-studies passage for Texas Grade ${brief.grade}.

Strand: ${brief.strand}
Topic: ${brief.topic}

Match the ${wordTarget} word target. ${para}. Apply ALL sensitive-topic rules. Return strict JSON.`;
}

function buildQuestionsSystem(grade) {
  const g = String(grade).toLowerCase();
  const earlyReader = ['k', '1', '2', '3'].includes(g);
  const middleGrade = ['4', '5', '6', '7'].includes(g);

  if (middleGrade) {
    return `You write multiple-choice social-studies questions for a Texas Grade ${grade} practice app, given a passage. Question types tested:
- Main idea / key argument
- Specific factual recall (dates, names, events, places)
- Cause and effect
- Compare and contrast
- Sequence / chronology

Output STRICT JSON:
{
  "questions": [
    {"stem":"","choices":["","","",""],"correctIndex":0,"explanation":"","questionType":"main-idea|key-detail|cause-effect|compare-contrast|sequence"}
  ]
}

Rules (LOCKED):
- Exactly 5 questions per passage.
- Mix question types — at least 3 distinct types across the 5.
- Vocabulary appropriate for ${g === '4' ? '9-10' : g === '5' ? '10-11' : g === '6' ? '11-12' : '12-13'}-year-old.
- Question must be answerable from the passage alone.
- Distractors plausible — common misconceptions or partial-truths.
- Explanation cites specific paragraph evidence. 1-2 sentences.

ONLY output valid JSON. No markdown fences, no preamble.`;
  }

  if (earlyReader) {
    return `You write multiple-choice social-studies questions for a Texas Grade ${grade} practice app, given a passage.

Output STRICT JSON:
{
  "questions": [
    {"stem":"","choices":["","","",""],"correctIndex":0,"explanation":"","questionType":"main-idea|key-detail|sequence"}
  ]
}

Rules (LOCKED):
- Exactly 5 questions per passage.
- Stick to MAIN IDEA, KEY DETAIL, and SIMPLE SEQUENCE for K/1/2/3.
- Stems and choices are SHORT — ${grade === 'k' ? '≤6' : grade === '1' ? '≤8' : grade === '2' ? '≤10' : '≤12'} words.
- Vocabulary at early-reader level. NO inference questions, NO author-purpose, NO compare-contrast for K/1/2/3.
- Question must be answerable from the passage alone.
- Explanation cites specific passage line. 1 short sentence.

ONLY output valid JSON. No markdown fences, no preamble.`;
  }
  return `You write multiple-choice questions for a Texas STAAR Grade 8 social studies practice app, given a passage. STAAR Grade 8 social studies questions test:
- Key idea / main argument
- Specific factual recall (dates, names, events)
- Cause and effect
- Compare and contrast
- Historical context / sequence
- Reading a quote or excerpt for meaning

Output STRICT JSON:

{
  "questions": [
    {
      "stem": "Question text",
      "choices": ["A", "B", "C", "D"],
      "correctIndex": 2,
      "explanation": "Brief: cite specific paragraph evidence. 1-2 sentences.",
      "questionType": "main-idea | key-detail | cause-effect | compare-contrast | sequence | excerpt-meaning"
    }
  ]
}

Rules (LOCKED):
- Exactly 5 questions per passage.
- Mix question types — at least 3 distinct types across the 5.
- Exactly 4 choices each, one correct.
- Distractors plausible — common misconceptions or partially-true statements.
- Question must be answerable from the passage alone.
- Explanation cites SPECIFIC passage evidence ("paragraph 3 explains...").
- NO graphic content. NO theology or proselytizing language. NO modern-political-party editorializing.

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildQuestionsUser(passage) {
  return `Generate 5 social-studies questions for the passage below.

Title: ${passage.title}

Passage:
${passage.body}

Return strict JSON.`;
}

function nowIso() { return new Date().toISOString(); }
function shortId() { return crypto.randomBytes(6).toString('hex'); }
function ensureOutputDir() { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); }

async function processBrief(brief, opts, apiKey) {
  console.log(`\n=== ${brief.id} (${brief.strand}) ===`);
  console.log(`topic: ${brief.topic.slice(0, 80)}${brief.topic.length > 80 ? '…' : ''}`);

  // Stage 1: passage
  console.log('  ⏳ generating passage…');
  const pSys = buildPassageSystem(brief.grade);
  const pUser = buildPassageUser(brief);
  let passageRaw;
  try {
    const resp = await callOpenAI(pSys, pUser, apiKey, { temperature: 0.6, max_tokens: 2200 });
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
  if (report.wordCount < 400 || report.wordCount > 800) {
    console.warn(`  ⚠ word-count ${report.wordCount} outside target 400-800 (proceeding anyway)`);
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

  // Build the records. stateGradeGenre format mirrors reading +
  // science: <state>_<grade>_<genre>. For social studies, we use a
  // single genre 'social-studies' so the lambda's GSI query is
  // straightforward.
  const passageId = `p_tx_${brief.grade}_ss_${shortId()}`;
  const stateGradeGenre = `${STATE}_${brief.grade}_${SUBJECT}`;
  const passageRow = {
    passageId,
    state: STATE,
    grade: brief.grade,
    subject: SUBJECT,
    genre: SUBJECT,
    stateGradeGenre,
    title,
    body,
    topic: brief.topic,
    topicNotes: String(passageJson.topicNotes || '').slice(0, 200),
    strand: brief.strand,
    wordCount: report.wordCount,
    paragraphCount: report.paragraphCount,
    fkGrade: report.fkGrade,
    lexileEstimate: report.lexileEstimate,
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'social-studies-openai-v1',
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
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'social-studies-openai-v1',
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

  // Idempotency: skip briefs whose ID is already in DDB.
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
  console.log(`[ss-openai] runId=${runId} mode=${opts.dryRun ? 'dry-run' : 'WRITE'} briefs=${briefs.length}`);

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

  const outPath = path.join(OUTPUT_DIR, `social-studies-openai-${runId}.json`);
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
