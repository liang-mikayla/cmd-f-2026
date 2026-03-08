const obProfile = { level: null, goal: null };

function startOnboarding() {
  document.getElementById('ob-welcome').style.display = 'none';
  document.getElementById('ob-step-1').classList.add('active');
}

function selectOb(el, key, val) {
  if (key === 'goal') {
    el.classList.toggle('selected');
    if (!Array.isArray(obProfile.goal)) obProfile.goal = [];
    if (el.classList.contains('selected')) {
      if (!obProfile.goal.includes(val)) obProfile.goal.push(val);
    } else {
      obProfile.goal = obProfile.goal.filter(v => v !== val);
    }
    const nextBtn = document.getElementById('ob-next-2');
    if (nextBtn) nextBtn.disabled = obProfile.goal.length === 0;
  } else {
    el.closest('.ob-options').querySelectorAll('.ob-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    obProfile[key] = val;
    const nextBtn = document.getElementById('ob-next-1');
    if (nextBtn) nextBtn.disabled = false;
  }
}

function goStep(n) {
  document.querySelectorAll('.ob-step').forEach(s => s.classList.remove('active'));
  document.getElementById(`ob-step-${n}`).classList.add('active');
}

function finishOnboarding() {
  document.getElementById('onboarding').classList.add('hidden');
  document.getElementById('app').classList.add('visible');
}
