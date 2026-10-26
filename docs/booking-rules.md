# Booking rules

What the app allows and refuses, as the code implements it. The routes are in `src/routes/`, the capacity check in
`src/models/booking.js`, the waiting list in `src/services/waitingList.js`.

## Accounts and age

- Requesting a login link for a new address creates the account. Nobody chooses a password.
- Before the first booking the person completes a profile: first name, last name, birth date, and acceptance of the
  terms and the privacy policy (marketing consent is a separate, optional box). A birth date in the future or more
  than 120 years ago is refused.
- People under 16 cannot hold an account. The form tells them that a parent books them from the parent's account.
- From 18 the account is verified at once. At 16 or 17 it stays unverified, and cannot book, until the person asks
  for verification on their dashboard and an administrator approves it at `/admin/consents` (the parental-consent
  check happens outside the app). A rejected request can be sent again.
- Every account holder counts as an adult for places. Administrators are the addresses in `ADMIN_EMAILS`; their rights
  are checked against that list on every request. Administrator accounts, and accounts given the instructor role, are
  verified.

## Classes

| Setting | Values |
| --- | --- |
| Type | `adult_only`, or `adult_and_child` (a family class) |
| Adult places | 1 to 200 |
| Child places | 1 to 200, family classes only |
| Duration | 15 minutes to 8 hours; 90 minutes when a new class has no end time |
| Instructors | an instructor account, or nobody; a family class can also have one for the children |
| Waiting list | on or off; holds 15 people for classes created in the admin panel |

In an `adult_only` class everyone must be 16 or older. In a family class people of 16 and over take adult places and
younger children take child places. The two pools are counted separately: a full child pool does not stop adults from
booking, and the other way round.

## Booking

- Booking is open until the class starts, for a verified account, on a class that is not cancelled.
- A booking always includes the account holder. Up to four more people can be added, each with a first name, a last
  name and an age in years.
- The free places of each pool are counted inside the same write transaction that inserts the booking. If the group
  does not fit, nothing is booked; there are no partial bookings.
- An account has at most one booking per class.

## Cancelling

- A participant can cancel the whole booking or one person in it, up to two hours before the class starts. A booking
  disappears with its last person.
- An administrator can remove any participant at any time. The person who made the booking gets an e-mail.
- Each of these frees places and gives the waiting list a chance to move.

## Waiting list

- It is offered when the class has one enabled and its adult pool is full. Only the account holder joins it, without
  extra people, and only once per class.
- If a place frees up between showing the page and joining, the person is sent to the normal booking form instead.
- When a place frees up, the first person on the list (by joining time) is booked as one adult, inside the same
  capacity transaction as any other booking, removed from the list and sent an e-mail. If the class is still full,
  nothing changes. A cancellation, a removal or a higher limit set by an administrator books as many people from the
  list as now fit, in list order, at once.
- Nobody is promoted into a class that is cancelled or has already started; the list stays as it is.
- Booking a class, by the list or directly, takes the person off that class's list. An entry whose person already
  has a booking of the class is dropped when the list moves, and the next person is promoted instead.
- A person can leave the list at any time from their dashboard.

## What the administrator does with classes

- **Cancel** takes a class off the public calendar and closes it for booking. Bookings are kept, and the class can be
  brought back. Participants are not e-mailed.
- **Archive** moves a class to `/admin/archive` with its bookings, from where it can be restored. At every start and
  once a day, classes that started before Monday of the current week are archived automatically.
- **Clone week** copies this week's classes (Monday to Sunday, not cancelled, not archived) 1 to 52 weeks ahead,
  without bookings. The start hour stays the same across a daylight-saving change. A copy whose name and start time
  already exist is skipped, so cloning the same week twice adds nothing.

## Instructors

- An administrator adds an instructor at `/admin/instructors` by e-mail address. An address without an account gets
  one, with the first and last name typed in the form; an existing account keeps its name. The first name is what the
  classes show.
- Removing the role takes the instructor panel away at once and unlinks the account from its classes; each class keeps
  the instructor's name as text until an administrator picks another instructor in the class form.
- The `users.is_instructor` flag is the only record of the role. The `INSTRUCTORS` variable of earlier versions is no
  longer read (the app warns when it is still set); the instructors it created keep the role.
- The instructor panel (`/instructor`) lists the classes where the account is the main or the children's instructor,
  and shows the participant list of those classes only. Administrators can open it too. Nothing there can be changed.

## The leaflet QR code

`/qr` is the address printed on the school's leaflet. It records the visit (an HMAC of the IP address and the first
300 characters of the user agent) and redirects to the calendar. The admin dashboard shows the number of visits.
