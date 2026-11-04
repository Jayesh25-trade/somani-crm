// Realistic sample data: ~6 months of treatment plans so every screen has something to show.
// Each patient gets medicine every 14 days (12 intervals) or 28 days (6 intervals) with one reminder per refill day.
// New patients per day are set so refill visits come to ≈ 40/day in Jalgaon and ≈ 5/day in Pune.
// Every record is flagged `sample: true` and can be removed from Settings → "Remove sample patients".
module.exports = function seed(db, { todayIST, addDays, newId, nextRegNo, buildPlan }) {
  let s = 20261101;
  const rnd = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const today = todayIST();
  const DAYS = 182;
  const first = addDays(today, -DAYS);
  const NEW_PER_DAY = { jalgaon: 4.1, pune: 0.52 };     // ≈ 40 and 5 refill visits a day once plans are running
  const DOCTOR = { jalgaon: 'antim', pune: 'kushal' };
  const STAFF = { jalgaon: 'Reception · Jalgaon', pune: 'Reception · Pune' };
  const AREAS = {
    jalgaon: ['Navi Peth', 'Ring Road', 'MJ College Road', 'Shivaji Nagar', 'Pimprala', 'Jilha Peth', 'Mehrun', 'Ganesh Colony', 'Bhusawal', 'Pachora'],
    pune: ['Wakad', 'Hinjewadi', 'Pimple Saudagar', 'Baner', 'Aundh', 'Ravet', 'Tathawade', 'Punawale'],
  };
  const MALE = ['Rahul', 'Amit', 'Sachin', 'Prakash', 'Vikram', 'Sameer', 'Nikhil', 'Anil', 'Rohan', 'Ganesh', 'Mahesh', 'Suresh', 'Yogesh', 'Kiran', 'Sandeep', 'Vijay', 'Ajay', 'Rajesh', 'Mangesh', 'Tushar', 'Pankaj', 'Hemant', 'Imran', 'Salim', 'Aarav', 'Vihaan', 'Arjun', 'Omkar', 'Dattatray', 'Shrikant', 'Manoj', 'Deepak', 'Nitin', 'Abhijit', 'Swapnil'];
  const FEMALE = ['Sunita', 'Meena', 'Kavita', 'Pooja', 'Sneha', 'Neha', 'Asha', 'Lata', 'Vaishali', 'Shubhangi', 'Manisha', 'Anjali', 'Priya', 'Swati', 'Rupali', 'Jyoti', 'Sarika', 'Archana', 'Smita', 'Varsha', 'Rekha', 'Shital', 'Komal', 'Ashwini', 'Madhuri', 'Rutuja', 'Gauri', 'Sakshi', 'Ananya', 'Ishita', 'Farida', 'Nasreen', 'Usha', 'Mangala', 'Prajakta'];
  const SURNAMES = ['Patil', 'Chaudhari', 'Mahajan', 'Wagh', 'Sonawane', 'Bari', 'Nemade', 'Deshmukh', 'Kulkarni', 'Joshi', 'Shinde', 'Pawar', 'Gokhale', 'More', 'Borse', 'Kale', 'Jadhav', 'Bhole', 'Attarde', 'Kolhe', 'Badgujar', 'Jain', 'Agrawal', 'Shaikh', 'Khan', 'Deshpande', 'Gaikwad', 'Salunkhe', 'Pathak', 'Marathe', 'Rane', 'Sapkale', 'Warke', 'Chavan', 'Thakur', 'Bhosale', 'Kadam', 'Mali'];
  const COMPLAINTS = ['Chronic migraine', 'Eczema', 'Psoriasis', 'Knee joint pain', 'Acidity, bloating', 'Hair fall', 'Allergic rhinitis', 'PCOD', 'Thyroid (hypo)', 'Recurrent cold & cough', 'Anxiety, poor sleep', 'Acne', 'Arthritis', 'Kidney stone', 'Varicose veins', 'Back pain', 'Asthma', 'Sinusitis', 'Urticaria', 'Piles', 'Warts', 'Tonsillitis', 'Constipation', 'Vitiligo', 'Diabetes support', 'Hypertension support', 'Menstrual pain', 'ADHD (child)', 'Bedwetting (child)', 'Gastritis'];
  const MEDS = ['Nat Mur 200 · 4 pills twice daily', 'Sulphur 30 · 4 pills thrice daily', 'Rhus Tox 200 · 4 pills twice daily', 'Nux Vomica 30 · 4 pills at night', 'Lycopodium 200 · weekly dose', 'Ars Alb 30 · 4 pills twice daily', 'Pulsatilla 200 · 4 pills twice daily', 'Calc Carb 30 · 3 pills twice daily', 'Ignatia 200 · 4 pills at night', 'Graphites 30 · 4 pills thrice daily', 'Hepar Sulph 30 · 4 pills twice daily', 'Bryonia 30 · 4 pills thrice daily', 'Berberis Q · 10 drops thrice daily', 'Hamamelis 30 · 4 pills twice daily', 'Belladonna 200 · SOS', 'Syzygium Q · 10 drops twice daily', 'Thuja 200 · weekly dose', 'Phosphorus 200 · weekly dose', 'Sepia 200 · 4 pills twice daily', 'Silicea 30 · 4 pills twice daily', 'Kali Bich 30 · 4 pills thrice daily', 'Apis Mel 30 · 4 pills thrice daily', 'Natrum Sulph 30 · 4 pills twice daily', 'Causticum 200 · weekly dose'];

  const phones = new Set();
  const newPhone = () => { let p; do { p = pick(['9', '9', '8', '7']) + String(Math.floor(rnd() * 1e9)).padStart(9, '0'); } while (phones.has(p)); phones.add(p); return p; };
  const at = (d, h0 = 10, h1 = 19) => new Date(Date.parse(d + 'T00:00:00+05:30') + (h0 + rnd() * (h1 - h0)) * 3600e3).toISOString();
  const names = new Set();
  const now = Date.now();

  function newPatient(loc, d) {
    let name, female;
    do { female = rnd() < 0.56; name = `${pick(female ? FEMALE : MALE)} ${pick(SURNAMES)}`; } while (names.has(name.toLowerCase()) && names.size < 2400);
    if (names.has(name.toLowerCase())) name += ' ' + String.fromCharCode(65 + Math.floor(rnd() * 26)) + '.';
    names.add(name.toLowerCase());
    const child = rnd() < 0.12;
    const p = {
      id: newId(), regNo: nextRegNo(loc), name, phone: newPhone(), altPhone: '',
      age: child ? 3 + Math.floor(rnd() * 12) : 18 + Math.floor(rnd() * 55), gender: female ? 'F' : 'M', location: loc,
      doctor: rnd() < 0.06 ? (DOCTOR[loc] === 'antim' ? 'kushal' : 'antim') : DOCTOR[loc],
      address: pick(AREAS[loc]), complaint: pick(COMPLAINTS), notes: '', sample: true, createdAt: at(d), createdBy: STAFF[loc],
    };
    db.patients.push(p);
    return p;
  }

  for (let k = 0; k <= DAYS; k++) {
    const d = addDays(first, k);
    for (const [loc, rate] of Object.entries(NEW_PER_DAY)) {
      const n = Math.floor(rate * (0.7 + rnd() * 0.6) + rnd());
      for (let j = 0; j < n; j++) {
        const p = newPatient(loc, d);
        const days = rnd() < 0.65 ? 14 : 28;
        const intervals = days === 14 ? 12 : 6;
        const c = {
          id: newId(), patientId: p.id, location: loc, status: 'active', reminders: [], startDate: d, days, intervals,
          dueDate: addDays(d, days), plan: buildPlan(days, intervals), medicine: pick(MEDS), createdAt: p.createdAt, createdBy: STAFF[loc],
        };
        p.lastVisit = d;
        // ~12% stop coming at some refill; staff usually stop the plan after two unanswered reminders
        const dropAt = rnd() < 0.12 ? 1 + Math.floor(rnd() * (intervals - 1)) : null;
        let unanswered = 0;
        for (const st of c.plan) {
          const sd = addDays(c.dueDate, st.offset);
          if (sd > today) break;
          const k1 = c.plan.indexOf(st) + 1;
          const sentP = sd === today ? 0.32 : sd >= addDays(today, -3) ? 0.9 : 0.993;
          if (rnd() < sentP) c.reminders.push({ at: sd === today ? new Date(now - rnd() * 2 * 3600e3).toISOString() : at(sd, 9.5, 13.5), by: STAFF[loc], stepId: st.id, templateId: st.templateId, channel: 'whatsapp', note: '' });
          if (dropAt && k1 >= dropAt) {
            unanswered++;
            if (unanswered >= 2 && rnd() < 0.95 && addDays(sd, 2) <= today) { c.status = 'stopped'; c.closedAt = at(addDays(sd, 2)); c.closedBy = STAFF[loc]; c.stopReason = 'Stopped coming'; break; }
          } else p.lastVisit = sd;
        }
        const lastDay = addDays(c.dueDate, c.plan[c.plan.length - 1].offset);
        if (c.status === 'active' && addDays(lastDay, 3) <= today && c.reminders.length === c.plan.length) {
          c.status = 'completed'; c.closedAt = at(addDays(lastDay, 1)); c.closedBy = STAFF[loc];
        } else if (c.status === 'active' && c.reminders.length) c.status = 'reminded';
        db.courses.push(c);
      }
    }
  }
};
