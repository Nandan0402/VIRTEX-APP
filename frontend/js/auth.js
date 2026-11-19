/**
 * auth.js - Tri-Role Authentication Controller
 * Virtex Fitness AI Gym Receptionist Platform
 * Handles Login and Sign-Up for Members, Personal Trainers, and Facility Admins.
 */

const ROLES = {
  member: {
    key: 'member',
    themeClass: 'theme-member',
    accentColor: '#00e676',
    brandAccent: 'FITNESS',
    loginTitle: 'Member Sign In',
    loginSubtitle: 'Welcome back! Sign in to access your membership profile and touchless kiosk check-in.',
    signupTitle: 'New Member Registration',
    signupSubtitle: 'Join Virtex Fitness. Select your tier and start checking in instantly with our AI FitBot.',
    loginBtnText: 'Sign In as Member',
    signupBtnText: 'Complete Member Registration',
    idLabel: 'Username, Email, or Phone',
    idHint: 'Member Code / Phone',
    idPlaceholder: 'e.g. member_rahul or 9876543210',
    destination: '/kiosk.html',
    demoLogin: {
      identifier: 'member_rahul',
      password: 'MemberPass2026!',
    },
    demoSignup: {
      fullName: 'Sanjay Verma',
      username: 'sanjay_fit',
      email: 'sanjay.verma@example.com',
      phone: '+91 98450 88221',
      planId: '2',
      language: 'en-IN',
      emergencyName: 'Rohit Verma',
      emergencyPhone: '+91 98450 88220',
      password: 'MemberPass2026!',
    },
  },
  trainer: {
    key: 'trainer',
    themeClass: 'theme-trainer',
    accentColor: '#22d3ee',
    brandAccent: 'COACHING',
    loginTitle: 'Personal Trainer Sign In',
    loginSubtitle: 'Coach access to live gym floor shifts, client training sessions, and availability.',
    signupTitle: 'Trainer Onboarding & Application',
    signupSubtitle: 'Join the Virtex coaching staff. Register your coaching specialty, certifications, and shifts.',
    loginBtnText: 'Sign In to Trainer Hub',
    signupBtnText: 'Register Trainer Account',
    idLabel: 'Trainer Username or Email',
    idHint: 'Trainer Code / Email',
    idPlaceholder: 'Your trainer username or email',
    destination: '/trainer-dashboard.html',
    demoLogin: {
      identifier: '',
      password: '',
    },
    demoSignup: {
      fullName: 'Vikram Coach',
      username: 'coach_vikram',
      email: 'vikram.coach@virtexfitness.in',
      phone: '+91 98112 33445',
      specialty: 'Strength & Conditioning',
      certifications: 'ACE-CPT, CSCS, CPR/AED',
      bio: 'Movement and strength conditioning coach specializing in barbell biomechanics.',
      password: 'TrainerPass2026!',
    },
  },
  admin: {
    key: 'admin',
    themeClass: 'theme-admin',
    accentColor: '#818cf8',
    brandAccent: 'EXECUTIVE',
    loginTitle: 'Admin & Operations Sign In',
    loginSubtitle: 'Executive console access to gym business KPIs, physical robot controls, and staff management.',
    signupTitle: 'Admin Account Provisioning',
    signupSubtitle: 'Provision owner-level management privileges for facility operations.',
    loginBtnText: 'Sign In to Admin Console',
    signupBtnText: 'Provision Owner Account',
    idLabel: 'Admin Username or Email',
    idHint: 'Admin Account / Email',
    idPlaceholder: 'e.g. nandanb449@gmail.com or your admin username',
    destination: '/admin?role=owner#tab-overview',
    demoLogin: {
      identifier: '',
      password: '',
    },
    demoSignup: {
      fullName: 'Kiran Deshmukh',
      username: 'kiran_director',
      email: 'kiran.director@virtexfitness.in',
      phone: '+91 99000 88776',
      password: 'AdminPass2026!',
    },
  },
};

class AuthPortal {
  constructor() {
    this.currentRole = 'member';
    this.currentMode = 'login'; // 'login' | 'signup'

    // DOM Elements
    this.body = document.body;
    this.glow = document.getElementById('auth-ambient-glow');
    this.pageTitle = document.getElementById('auth-page-title');
    this.pageSubtitle = document.getElementById('auth-page-subtitle');
    this.brandAccent = document.getElementById('brand-accent-text');

    this.tabMember = document.getElementById('tab-member');
    this.tabTrainer = document.getElementById('tab-trainer');
    this.tabAdmin = document.getElementById('tab-admin');

    this.modeBtnLogin = document.getElementById('mode-btn-login');
    this.modeBtnSignup = document.getElementById('mode-btn-signup');

    this.sectionLogin = document.getElementById('section-login');
    this.sectionSignupMember = document.getElementById('section-signup-member');
    this.sectionSignupTrainer = document.getElementById('section-signup-trainer');
    this.sectionSignupAdmin = document.getElementById('section-signup-admin');

    this.loginIdLabel = document.getElementById('login-identifier-label');
    this.loginIdHint = document.getElementById('login-identifier-hint');
    this.loginIdentifierInput = document.getElementById('login-identifier');
    this.loginPasswordInput = document.getElementById('login-password');

    this.authForm = document.getElementById('auth-form');
    this.authAlert = document.getElementById('auth-alert');
    this.submitBtn = document.getElementById('btn-submit-auth');
    this.submitText = document.getElementById('btn-submit-text');
    this.submitSpinner = document.getElementById('btn-submit-spinner');
  }

  init() {
    // 1. Read query params (?role=member&mode=signup)
    const params = new URLSearchParams(window.location.search);
    const initialRole = params.get('role');
    const initialMode = params.get('mode');

    if (initialRole && ROLES[initialRole]) {
      this.currentRole = initialRole;
    }
    // Public sign-up is disabled (accounts are created by the gym admin), so ?mode=signup opens sign in.
    void initialMode;
    this.currentMode = 'login';

    this.bindEvents();
    this.render();
  }

  bindEvents() {
    // Role switcher tabs
    this.tabMember.addEventListener('click', () => this.switchRole('member'));
    this.tabTrainer.addEventListener('click', () => this.switchRole('trainer'));
    this.tabAdmin.addEventListener('click', () => this.switchRole('admin'));

    // Mode buttons
    this.modeBtnLogin.addEventListener('click', () => this.switchMode('login'));
    this.modeBtnSignup?.addEventListener('click', () => this.switchMode('login'));

    // Form submit
    this.authForm.addEventListener('submit', (e) => this.handleSubmit(e));
  }

  switchRole(role) {
    if (!ROLES[role] || this.currentRole === role) return;
    this.currentRole = role;
    this.updateUrlParams();
    this.render();
  }

  switchMode(mode) {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.updateUrlParams();
    this.render();
  }

  updateUrlParams() {
    const url = new URL(window.location);
    url.searchParams.set('role', this.currentRole);
    url.searchParams.set('mode', this.currentMode);
    window.history.replaceState({}, '', url);
  }

  showAlert(message, type = 'error') {
    this.authAlert.className = `auth-alert ${type}`;
    this.authAlert.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span>${type === 'error' ? '⚠️' : '✅'}</span>
        <span>${message}</span>
      </div>
    `;
    this.authAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  hideAlert() {
    this.authAlert.className = 'auth-alert';
    this.authAlert.innerHTML = '';
  }

  render() {
    const roleConfig = ROLES[this.currentRole];
    this.hideAlert();

    // 1. Theme and branding
    this.body.className = roleConfig.themeClass;
    if (this.brandAccent) {
      this.brandAccent.textContent = roleConfig.brandAccent;
      this.brandAccent.style.color = roleConfig.accentColor;
    }

    // 2. Active Tab Button states
    [this.tabMember, this.tabTrainer, this.tabAdmin].forEach((tab) => {
      tab.classList.remove('active');
    });
    if (this.currentRole === 'member') this.tabMember.classList.add('active');
    if (this.currentRole === 'trainer') this.tabTrainer.classList.add('active');
    if (this.currentRole === 'admin') this.tabAdmin.classList.add('active');

    // 3. Mode Toggle states
    if (this.currentMode === 'login') {
      this.modeBtnLogin.classList.add('active');
      this.modeBtnLogin.setAttribute('aria-selected', 'true');
      this.modeBtnSignup.classList.remove('active');
      this.modeBtnSignup.setAttribute('aria-selected', 'false');

      this.pageTitle.textContent = roleConfig.loginTitle;
      this.pageSubtitle.textContent = roleConfig.loginSubtitle;
      this.submitText.textContent = roleConfig.loginBtnText;
    } else {
      this.modeBtnSignup.classList.add('active');
      this.modeBtnSignup.setAttribute('aria-selected', 'true');
      this.modeBtnLogin.classList.remove('active');
      this.modeBtnLogin.setAttribute('aria-selected', 'false');

      this.pageTitle.textContent = roleConfig.signupTitle;
      this.pageSubtitle.textContent = roleConfig.signupSubtitle;
      this.submitText.textContent = roleConfig.signupBtnText;
    }

    // 4. Input labels and placeholders
    this.loginIdLabel.textContent = roleConfig.idLabel;
    this.loginIdHint.textContent = roleConfig.idHint;
    this.loginIdentifierInput.placeholder = roleConfig.idPlaceholder;

    // 5. Show/Hide Form Sections
    if (this.currentMode === 'login') {
      this.sectionLogin.style.display = 'grid';
      this.sectionSignupMember.style.display = 'none';
      this.sectionSignupTrainer.style.display = 'none';
      this.sectionSignupAdmin.style.display = 'none';
    } else {
      this.sectionLogin.style.display = 'none';
      this.sectionSignupMember.style.display = this.currentRole === 'member' ? 'grid' : 'none';
      this.sectionSignupTrainer.style.display = this.currentRole === 'trainer' ? 'grid' : 'none';
      this.sectionSignupAdmin.style.display = this.currentRole === 'admin' ? 'grid' : 'none';
    }
  }

  async handleSubmit(e) {
    e.preventDefault();
    this.hideAlert();

    const roleConfig = ROLES[this.currentRole];
    this.setLoading(true);

    try {
      if (this.currentMode === 'login') {
        await this.handleLogin(roleConfig);
      } else {
        await this.handleSignup(roleConfig);
      }
    } catch (err) {
      this.showAlert(err.message || 'Authentication request failed. Please try again.');
    } finally {
      this.setLoading(false);
    }
  }

  async handleLogin(roleConfig) {
    const identifier = this.loginIdentifierInput.value.trim();
    const password = this.loginPasswordInput.value;

    if (!identifier) {
      throw new Error(`Please enter your ${roleConfig.idLabel.toLowerCase()}.`);
    }
    if (!password) {
      throw new Error('Please enter your account password.');
    }

    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: identifier, password }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Invalid credentials or inactive account.');
    }

    // Save tokens and session
    this.persistAuthSession(result.data);

    this.showAlert(`Welcome back, ${result.data.user.fullName}! Redirecting to your dashboard...`, 'success');

    // Tailored role redirection
    setTimeout(() => {
      let dest = roleConfig.destination;
      // If user is actually an owner or manager logging in from another tab, respect user.role
      if (result.data.user.role === 'owner' || result.data.user.role === 'superadmin') {
        dest = '/admin?role=owner#tab-overview';
      } else if (result.data.user.role === 'trainer') {
        dest = '/trainer-dashboard.html';
      } else if (result.data.user.role === 'member') {
        dest = '/kiosk.html';
      }
      window.location.href = dest;
    }, 800);
  }

  async handleSignup(roleConfig) {
    let payload = {};

    if (this.currentRole === 'member') {
      const fullName = document.getElementById('mem-fullname').value.trim();
      const username = document.getElementById('mem-username').value.trim();
      const email = document.getElementById('mem-email').value.trim();
      const phone = document.getElementById('mem-phone').value.trim();
      const planId = document.getElementById('mem-plan').value;
      const preferredLanguage = document.getElementById('mem-language').value;
      const emergencyName = document.getElementById('mem-emergency-name').value.trim();
      const emergencyPhone = document.getElementById('mem-emergency-phone').value.trim();
      const password = document.getElementById('mem-password').value;
      const confirm = document.getElementById('mem-password-confirm').value;

      if (!fullName || !username || !email || !password) {
        throw new Error('Please fill in all required fields (Full Name, Username, Email, and Password).');
      }
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long.');
      }
      if (password !== confirm) {
        throw new Error('Passwords do not match. Please re-enter.');
      }

      payload = {
        role: 'member',
        fullName,
        username,
        email,
        phone,
        planId,
        preferredLanguage,
        emergencyContactName: emergencyName,
        emergencyContactPhone: emergencyPhone,
        password,
      };
    } else if (this.currentRole === 'trainer') {
      const fullName = document.getElementById('trn-fullname').value.trim();
      const username = document.getElementById('trn-username').value.trim();
      const email = document.getElementById('trn-email').value.trim();
      const phone = document.getElementById('trn-phone').value.trim();
      const specialty = document.getElementById('trn-specialty').value;
      const certifications = document.getElementById('trn-certifications').value.trim();
      const bio = document.getElementById('trn-bio').value.trim();
      const password = document.getElementById('trn-password').value;
      const confirm = document.getElementById('trn-password-confirm').value;

      if (!fullName || !username || !email || !password) {
        throw new Error('Please fill in all required fields (Full Name, Username, Email, and Password).');
      }
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long.');
      }
      if (password !== confirm) {
        throw new Error('Passwords do not match. Please re-enter.');
      }

      payload = {
        role: 'trainer',
        fullName,
        username,
        email,
        phone,
        specialty,
        certifications,
        bio,
        password,
      };
    } else if (this.currentRole === 'admin') {
      const fullName = document.getElementById('adm-fullname').value.trim();
      const username = document.getElementById('adm-username').value.trim();
      const email = document.getElementById('adm-email').value.trim();
      const phone = document.getElementById('adm-phone').value.trim();
      const password = document.getElementById('adm-password').value;
      const confirm = document.getElementById('adm-password-confirm').value;

      if (!fullName || !username || !email || !password) {
        throw new Error('Please fill in all required fields (Full Name, Username, Email, and Password).');
      }
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long.');
      }
      if (password !== confirm) {
        throw new Error('Passwords do not match. Please re-enter.');
      }

      payload = {
        role: 'admin',
        fullName,
        username,
        email,
        phone,
        password,
      };
    }

    const response = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Registration failed. Please check your information and try again.');
    }

    // Save tokens and session
    this.persistAuthSession(result.data);

    this.showAlert(`Account created successfully! Welcome, ${result.data.user.fullName}! Redirecting...`, 'success');

    setTimeout(() => {
      window.location.href = roleConfig.destination;
    }, 1000);
  }

  persistAuthSession(authData) {
    if (!authData || !authData.token) return;

    localStorage.setItem('virtex_admin_jwt_token', authData.token);
    localStorage.setItem('virtex_admin_user_profile', JSON.stringify(authData.user));

    if (authData.user.role === 'member') {
      localStorage.setItem('virtex_active_member', JSON.stringify(authData.user));
    }
  }

  setLoading(isLoading) {
    if (isLoading) {
      this.submitBtn.disabled = true;
      this.submitSpinner.style.display = 'inline-block';
      this.submitText.textContent = 'Authenticating...';
    } else {
      this.submitBtn.disabled = false;
      this.submitSpinner.style.display = 'none';
      const roleConfig = ROLES[this.currentRole];
      this.submitText.textContent = this.currentMode === 'login' ? roleConfig.loginBtnText : roleConfig.signupBtnText;
    }
  }
}

// Instantiate and initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  const portal = new AuthPortal();
  portal.init();
});

