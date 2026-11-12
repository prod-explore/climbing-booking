/**
 * demoSchedule.js — the sample data of the demo instance as plain data, and the calendar built from it: a weekly
 * timetable placed relative to "today", the fictitious people who fill it, and how full each class is.
 *
 * No database access here (services/demoData.js writes it), so the same code can be tested with any `now`.
 * Every name, address and number is made up. Addresses are on `demo.test`, a reserved TLD (RFC 2606) that can never
 * receive mail; no real person is meant.
 */

'use strict';

/** The domain of every sample address. `.test` is reserved, so nothing sent there could arrive anywhere. */
const DEMO_DOMAIN = 'demo.test';

/** Weeks the timetable is generated for, as offsets from the current week: two behind (history), this one, the next. */
const WEEK_OFFSETS = Object.freeze([-2, -1, 0, 1]);

const STAFF = Object.freeze([
  { firstName: 'Anna', lastName: 'Nowicka' },
  { firstName: 'Piotr', lastName: 'Mazur' },
  { firstName: 'Ola', lastName: 'Jabłońska' },
  { firstName: 'Marek', lastName: 'Dąbrowski' },
  { firstName: 'Karolina', lastName: 'Wójcik' }
]);

/** The e-mail of an instructor: anna.instruktor@demo.test. */
const staffEmail = firstName => `${firstName.toLowerCase()}.instruktor@${DEMO_DOMAIN}`;

// ---------------------------------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------------------------------

/** Masculine form of a Polish surname: Kowalska -> Kowalski, Nowak -> Nowak. */
const mascSurname = last => last.replace(/(ska|cka|dzka)$/, m => m.slice(0, -1) + 'i');
/** Feminine form: Kowalski -> Kowalska. */
const femSurname = last => last.replace(/(ski|cki|dzki)$/, m => m.slice(0, -1) + 'a');

/** ASCII-only lower case, for the local part of an address: Zofia Woźniak -> zofia.wozniak. */
function asciiSlug(text) {
  return text
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

// first name, masculine surname, 'f' | 'm', partner's first name (or ''), children as [first name, age, 'f' | 'm'].
// The people with children are the ones who book the family classes.
const PEOPLE_ROWS = [
  ['Agnieszka', 'Kowalczyk', 'f', 'Marcin', [['Hania', 8, 'f'], ['Staś', 6, 'm']]],
  ['Beata', 'Mazur', 'f', '', [['Julek', 9, 'm']]],
  ['Dominika', 'Krawczyk', 'f', 'Kamil', []],
  ['Ewa', 'Nowak', 'f', 'Piotr', [['Zuzia', 7, 'f']]],
  ['Joanna', 'Pawlak', 'f', '', []],
  ['Katarzyna', 'Zielińska', 'f', 'Michał', [['Zosia', 7, 'f'], ['Antek', 10, 'm']]],
  ['Magdalena', 'Szymańska', 'f', '', [['Maja', 9, 'f']]],
  ['Marta', 'Wójcik', 'f', 'Bartek', []],
  ['Natalia', 'Lewandowska', 'f', '', []],
  ['Paulina', 'Kamińska', 'f', 'Adrian', [['Leon', 8, 'm'], ['Ola', 5, 'f']]],
  ['Sylwia', 'Dąbrowska', 'f', '', []],
  ['Weronika', 'Jabłońska', 'f', 'Sebastian', []],
  ['Zofia', 'Woźniak', 'f', '', [['Kuba', 6, 'm']]],
  ['Aleksandra', 'Kozłowska', 'f', '', []],
  ['Monika', 'Jankowska', 'f', 'Rafał', [['Ignaś', 7, 'm']]],
  ['Iwona', 'Sikora', 'f', '', []],
  ['Justyna', 'Grabowska', 'f', 'Łukasz', []],
  ['Patrycja', 'Wieczorek', 'f', '', []],
  ['Renata', 'Pietrzak', 'f', '', [['Alicja', 10, 'f']]],
  ['Adam', 'Kowalski', 'm', 'Ewelina', []],
  ['Bartosz', 'Wiśniewski', 'm', '', []],
  ['Cezary', 'Wojciechowski', 'm', '', [['Franek', 8, 'm'], ['Lena', 6, 'f']]],
  ['Damian', 'Kwiatkowski', 'm', 'Aneta', []],
  ['Jakub', 'Piotrowski', 'm', '', []],
  ['Krzysztof', 'Grabowski', 'm', 'Dorota', [['Basia', 9, 'f']]],
  ['Maciej', 'Król', 'm', '', []],
  ['Michał', 'Wieczorek', 'm', 'Karolina', []],
  ['Paweł', 'Jabłoński', 'm', '', [['Tymek', 7, 'm']]],
  ['Rafał', 'Majewski', 'm', 'Sandra', []],
  ['Sebastian', 'Olszewski', 'm', '', []],
  ['Tomasz', 'Wiśniewski', 'm', 'Marta', [['Oliwia', 8, 'f']]],
  ['Wojciech', 'Stępień', 'm', '', []],
  ['Marcin', 'Malinowski', 'm', 'Julia', []],
  ['Kamil', 'Górski', 'm', '', []],
  ['Bartłomiej', 'Rutkowski', 'm', 'Weronika', []],
  ['Grzegorz', 'Zając', 'm', '', []]
];

const nameFor = (last, gender) => (gender === 'f' ? femSurname(last) : mascSurname(last));

/** The sample participants: `{ email, firstName, lastName, partner, kids }`; `partner` and the kids carry full names. */
const PEOPLE = Object.freeze(PEOPLE_ROWS.map(([firstName, last, gender, partnerFirst, kids]) => {
  const lastName = nameFor(last, gender);
  return Object.freeze({
    email: `${asciiSlug(firstName)}.${asciiSlug(lastName)}@${DEMO_DOMAIN}`,
    firstName,
    lastName,
    partner: partnerFirst ? { firstName: partnerFirst, lastName: nameFor(last, gender === 'f' ? 'm' : 'f') } : null,
    kids: kids.map(([kidFirst, age, kidGender]) => ({ firstName: kidFirst, lastName: nameFor(last, kidGender), age }))
  });
}));

// ---------------------------------------------------------------------------------------------------------------------
// The timetable
// ---------------------------------------------------------------------------------------------------------------------

const ADULTS = 'adult_only';
const FAMILY = 'adult_and_child';

/**
 * One row per class of a week. `fill` is how full the class is in each week of WEEK_OFFSETS (-2, -1, 0, +1): 0 is
 * empty, 1 is full (and gets a waiting list when it is still ahead), null means the class does not run that week. Only
 * the rows that run in the past weeks make up the history of the participants and of the archive. `demo` says, week by
 * week, what the demo participant does: `b` has a booking, `w` waits for a place, `.` nothing.
 */
function row(day, time, minutes, name, level, type, spots, child, color, instructor, childInstructor, fill, demo = '....') {
  return { day, time, minutes, name, level, type, spots, child, color, instructor, childInstructor, fill, demo };
}

const TIMETABLE = Object.freeze([
  // Monday
  row(0, '10:00', 75, 'Poranny trening', 'wszystkie poziomy', ADULTS, 8, 0, '#14b8a6', 'Karolina', '', [null, null, 0.5, 0.38]),
  row(0, '17:00', 90, 'Wspinaczka dla początkujących', 'początkujący', ADULTS, 12, 0, '#2d5a3d', 'Anna', '', [0.67, 0.83, 0.75, 0.58], 'b..b'),
  row(0, '19:00', 90, 'Technika dla średniozaawansowanych', 'średniozaawansowany', ADULTS, 10, 0, '#6366f1', 'Piotr', '', [null, null, 0.9, 0.7]),
  // Tuesday
  row(1, '10:00', 60, 'Mobilność i rozciąganie dla wspinaczy', 'wszystkie poziomy', ADULTS, 14, 0, '#22c55e', 'Ola', '', [null, null, 0.29, 0]),
  row(1, '16:30', 120, 'Zajęcia rodzinne', 'początkujący', FAMILY, 10, 8, '#f59e0b', 'Anna', 'Ola', [null, null, 0.6, 0.7]),
  row(1, '18:00', 90, 'Technika na przewieszeniu', 'zaawansowany', ADULTS, 8, 0, '#8b5cf6', 'Piotr', '', [0.5, 0.75, 0.5, 0.88], '.b..'),
  row(1, '19:30', 90, 'Wieczorny bouldering', 'średniozaawansowany', ADULTS, 8, 0, '#0ea5e9', 'Marek', '', [null, null, 0.5, 1]),
  // Wednesday
  row(2, '10:30', 120, 'Kurs wspinaczki z liną: podstawy', 'początkujący', ADULTS, 6, 0, '#ef4444', 'Marek', '', [null, null, 0.5, 0.67]),
  row(2, '16:00', 120, 'Zajęcia rodzinne', 'początkujący', FAMILY, 10, 8, '#f59e0b', 'Anna', 'Ola', [0.8, 0.9, 0.7, 0.8], '.b..'),
  row(2, '18:00', 90, 'Wspinaczka dla początkujących', 'początkujący', ADULTS, 12, 0, '#2d5a3d', 'Karolina', '', [null, null, 0.83, 0.92]),
  row(2, '19:30', 75, 'Trening siłowy na ściance', 'średniozaawansowany', ADULTS, 10, 0, '#ec4899', 'Marek', '', [null, null, 0.2, 0]),
  // Thursday
  row(3, '17:30', 90, 'Bouldering', 'wszystkie poziomy', ADULTS, 15, 0, '#0ea5e9', 'Piotr', '', [0.6, 0.73, 0.67, 0.8], '.b.b'),
  row(3, '18:00', 90, 'Trening techniki (komplet)', 'zaawansowany', ADULTS, 4, 0, '#8b5cf6', 'Piotr', '', [null, null, 1, 1], '...w'),
  row(3, '19:30', 90, 'Wspinaczka dla początkujących', 'początkujący', ADULTS, 12, 0, '#2d5a3d', 'Karolina', '', [null, null, 0.33, 0.25]),
  // Friday
  row(4, '16:00', 90, 'Dziecięca ścianka 6–9 lat', 'początkujący', FAMILY, 8, 10, '#f97316', 'Ola', 'Anna', [null, null, 0.5, 0.9]),
  row(4, '18:00', 90, 'Piątkowy trening wytrzymałościowy', 'średniozaawansowany', ADULTS, 10, 0, '#d946ef', 'Marek', '', [null, null, 0.6, 0.3]),
  row(4, '19:30', 90, 'Otwarta sesja z instruktorem', 'wszystkie poziomy', ADULTS, 14, 0, '#64748b', 'Karolina', '', [0.43, 0.5, 0.14, 0.5], '..b.'),
  // Saturday
  row(5, '10:00', 120, 'Sobota na ściance', 'początkujący', FAMILY, 12, 10, '#ec4899', 'Anna', 'Ola', [0.75, 0.83, 0.83, 0.92], 'b.bb'),
  row(5, '12:30', 120, 'Kurs wspinaczki z liną dla dorosłych', 'początkujący', ADULTS, 6, 0, '#ef4444', 'Marek', '', [null, null, 1, 0.83]),
  row(5, '14:00', 90, 'Bouldering dla początkujących', 'początkujący', ADULTS, 12, 0, '#06b6d4', 'Piotr', '', [0.58, 0.67, 0.58, 0.33]),
  row(5, '16:00', 90, 'Techniki asekuracji', 'średniozaawansowany', ADULTS, 8, 0, '#84cc16', 'Karolina', '', [null, null, 0, 0.63]),
  // Sunday
  row(6, '11:00', 120, 'Niedzielne wspinanie rodzinne', 'początkujący', FAMILY, 12, 10, '#f59e0b', 'Anna', 'Ola', [0.67, 0.58, 0.58, 0.75]),
  row(6, '13:30', 90, 'Trening dla zaawansowanych', 'zaawansowany', ADULTS, 8, 0, '#6366f1', 'Piotr', '', [null, null, 0.75, 0.5]),
  row(6, '16:00', 60, 'Joga i mobilność', 'wszystkie poziomy', ADULTS, 14, 0, '#22c55e', 'Ola', '', [null, null, 0.36, 0.14])
]);

/** Local "YYYY-MM-DDTHH:mm" of the given day of the week (0 = Monday) `weekOffset` weeks from `now`, as the admin form stores it. */
function classStart(weekOffset, day, time, now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + weekOffset * 7 + day);
  const [h, m] = time.split(':').map(Number);
  date.setHours(h, m, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** How many of `spots` places a class of the given fill (0..1) has taken: any positive fill takes at least one. */
const takenFor = (spots, fill) => (fill > 0 ? Math.max(1, Math.round(spots * fill)) : 0);

/**
 * The classes of the demo calendar, relative to `now`: every row of the timetable in every week it runs (the past two
 * weeks, this one and the next), earliest first. Each class has `startTime`, `weekOffset`, `adultTarget`/`childTarget`
 * (places to fill), `full` and the demo participant's part (`demo`: 'b', 'w' or '.').
 */
function buildSchedule(now = new Date()) {
  const classes = [];
  WEEK_OFFSETS.forEach((weekOffset, weekIndex) => {
    for (const t of TIMETABLE) {
      const fill = t.fill[weekIndex];
      if (fill === null) continue;
      classes.push({
        ...t,
        weekOffset,
        startTime: classStart(weekOffset, t.day, t.time, now),
        adultTarget: takenFor(t.spots, fill),
        childTarget: t.type === FAMILY ? takenFor(t.child, fill) : 0,
        full: fill >= 1,
        demo: t.demo[weekIndex]
      });
    }
  });
  return classes.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

module.exports = { DEMO_DOMAIN, WEEK_OFFSETS, STAFF, PEOPLE, TIMETABLE, staffEmail, asciiSlug, classStart, takenFor, buildSchedule };
