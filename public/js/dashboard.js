/**
 * dashboard.js — the participant dashboard (views/user/dashboard.ejs): the class modal of the weekly calendar and
 * the active/past booking tabs. Loaded at the end of <body>, so the elements already exist.
 */

/* ── Modal logic ───────────────────────────────────────── */
const modal        = document.getElementById('classModal');
const modalClose   = document.getElementById('modalClose');
const modalAccent  = document.getElementById('modalAccent');
const modalTitle   = document.getElementById('modalTitle');
const modalTime    = document.getElementById('modalTime');
const modalMeta    = document.getElementById('modalMeta');
const modalDesc    = document.getElementById('modalDesc');
const modalSpots   = document.getElementById('modalSpots');
const modalActions = document.getElementById('modalActions');
const isLoggedIn   = true; // the dashboard is only served to a logged-in user

function openModal(el) {
  const d = el.dataset;
  const isCancelled = d.cancelled === '1';
  const adultLeft   = parseInt(d.adultLeft);
  const childLeft   = parseInt(d.childLeft);
  const isFull      = adultLeft <= 0;
  const isMixed     = d.type === 'adult_and_child';

  modalAccent.style.background = getComputedStyle(el).getPropertyValue('--ev-color');
  modalTitle.textContent = d.name;
  modalTime.textContent  = d.time;

  // Names come from the database: set them as text, never as markup.
  const meta = [];
  if (d.instructor)      meta.push(`👤 ${d.instructor}`);
  if (d.childInstructor) meta.push(`🧒 Animacje: ${d.childInstructor}`);
  meta.push(isMixed ? '👥 Dorośli + Dzieci' : '🧑 Tylko dorośli');
  modalMeta.replaceChildren(...meta.map(text => {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }));

  const fullDesc = d.description || '';
  if (fullDesc.length > 250) {
    const shortDesc = fullDesc.substring(0, 250) + '... ';
    modalDesc.innerHTML = '';
    const textSpan = document.createElement('span');
    textSpan.textContent = shortDesc;
    const moreBtn = document.createElement('a');
    moreBtn.textContent = 'Pokaż więcej';
    moreBtn.style.cursor = 'pointer';
    moreBtn.style.color = 'var(--brand)';
    moreBtn.style.fontWeight = '700';
    moreBtn.onclick = () => {
      textSpan.textContent = fullDesc;
      moreBtn.style.display = 'none';
    };
    modalDesc.appendChild(textSpan);
    modalDesc.appendChild(moreBtn);
    modalDesc.style.display = '';
  } else {
    modalDesc.textContent = fullDesc;
    modalDesc.style.display = fullDesc ? '' : 'none';
  }

  let spots = `<div class="modal-spots-row">`;
  spots += `<span class="modal-spot-label ${adultLeft <= 3 ? 'low' : ''}">🧑 Dorośli: ${adultLeft} wolnych</span>`;
  if (isMixed) {
    spots += `<span class="modal-spot-label ${childLeft <= 3 ? 'low' : ''}">👦 Dzieci: ${childLeft} wolnych</span>`;
  }
  spots += `</div>`;
  modalSpots.innerHTML = spots;

  let actions;
  if (isCancelled) {
    actions = `<span class="badge badge--full">Zajęcia odwołane</span>`;
  } else if (isFull) {
    if (isLoggedIn) {
      // Pełne zajęcia — prowadź do /book gdzie może być lista rezerwowa
      actions = `<a href="/book/${d.id}" class="btn btn--outline btn--lg">📋 Sprawdź listę rezerwową →</a>`;
    } else {
      actions = `<span class="badge badge--full">Brak miejsc</span>`;
    }
  } else if (isLoggedIn) {
    actions = `<a href="/book/${d.id}" class="btn btn--primary btn--lg">Zapisz się →</a>`;
  } else {
    actions = `<a href="/login?next=/book/${d.id}" class="btn btn--primary btn--lg">Zaloguj się, by się zapisać →</a>`;
  }
  modalActions.innerHTML = actions;

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  modalClose.focus();
}

function closeModal() {
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

/* Bind events */
document.querySelectorAll('.kcal-ev').forEach(el => {
  el.addEventListener('click', () => openModal(el));
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(el); } });
});

modalClose.addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ── Booking tabs logic ────────────────────────────────── */
function switchBookingTab(tab) {
  const btns = document.querySelectorAll('.custom-tab-btn');
  const cards = document.querySelectorAll('#bookingsList .booking-card');
  
  btns.forEach(b => b.classList.toggle('active', b.dataset.target === tab));

  let visibleCount = 0;
  cards.forEach(card => {
    if (card.dataset.status === tab) {
      card.style.display = 'flex';
      visibleCount++;
    } else {
      card.style.display = 'none';
    }
  });

  const emptyMsg = document.getElementById('bookingsEmptyMsg');
  if (visibleCount === 0) {
    if (!emptyMsg) {
      const msg = document.createElement('div');
      msg.id = 'bookingsEmptyMsg';
      msg.className = 'empty-state';
      msg.classList.add('empty-state--tab');
      const text = document.createElement('p');
      text.textContent = 'Brak zapisów w tej kategorii.';
      msg.appendChild(text);
      document.getElementById('bookingsList').appendChild(msg);
    } else {
      emptyMsg.style.display = '';
    }
  } else if (emptyMsg) {
    emptyMsg.style.display = 'none';
  }
}

// Initialize booking tabs – DOM is already ready at this point (inline script at bottom of body).
// Listeners, not onclick attributes: the CSP (script-src-attr 'none') blocks inline handlers.
document.querySelectorAll('.custom-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchBookingTab(btn.dataset.target));
});
if (document.querySelector('.custom-tab-btn')) {
  switchBookingTab('active');
}
