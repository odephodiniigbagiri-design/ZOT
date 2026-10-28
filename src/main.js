
import './style.css'

document.querySelector('#app').innerHTML = `
  <main class="page">
    <nav class="nav">
      <a class="brand" href="#" aria-label="ZOT home">
        <span class="brand-mark">Z</span>
        <span>ZENITH <strong>ONLINE TUTORIALS</strong></span>
      </a>
      <span class="secure"><span class="dot"></span> STUDENT PORTAL</span>
    </nav>

    <section class="hero">
      <div class="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div>
      <h1>Welcome to <span>ZOT.</span></h1>
      <p class="intro">
        Your gateway to tutorial registration, attendance,
        and your academic journey with Zenith Online Tutorials.
      </p>

      <div class="notice">
        <div class="notice-icon">✓</div>
        <div>
          <strong>Already paid for a tutorial?</strong>
          <p>Your administrator must confirm your payment before
          you can begin registration.</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel-heading">
          <div>
            <h2>Student registration</h2>
            <p>Start with the email address you gave the administrator.</p>
          </div>
          <span class="step">STEP 01 / 03</span>
        </div>

        <form id="email-form">
          <label for="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
          <button type="submit">Continue to verification <span>→</span></button>
          <p id="message" class="message" role="status" aria-live="polite"></p>
        </form>

        <div class="footnote">
          <span>▣</span>
          Registration opens only after your payment has been confirmed.
        </div>
      </div>

      <div class="steps">
        <div class="step-item active"><span>1</span><div><strong>Email</strong><small>Verify access</small></div></div>
        <div class="step-line"></div>
        <div class="step-item"><span>2</span><div><strong>Register</strong><small>Your details</small></div></div>
        <div class="step-line"></div>
        <div class="step-item"><span>3</span><div><strong>Dashboard</strong><small>Your ZOT portal</small></div></div>
      </div>
    </section>

    <footer>
      <span>© ${new Date().getFullYear()} Zenith Online Tutorials</span>
      <span>LEARN WITH PURPOSE. PREPARE WITH CONFIDENCE.</span>
    </footer>
  </main>
`

document.querySelector('#email-form').addEventListener('submit', (event) => {
  event.preventDefault()
  document.querySelector('#message').textContent =
    'The interface is ready. Email verification will be activated when we connect the secure registration backend.'
})


import { supabase } from './supabase.js';

async function testSupabaseConnection() {
  const { error } = await supabase
    .from('tutorials')
    .select('id')
    .limit(1);

  if (error) {
    console.error('ZOT database connection test failed:', error.message);
    return;
  }

  console.log('ZOT database connection successful!');
}

testSupabaseConnection();
