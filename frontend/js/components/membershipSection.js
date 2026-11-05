/**
 * membershipSection.js - Renders Live PostgreSQL Membership Plans, Operating Hours, and Facility Contact
 */

import { api } from '../services/api.js';

export class MembershipSectionComponent {
  constructor({ plansContainerId, hoursContainerId, contactContainerId, enquiryModalId, onEnquirySubmitted }) {
    this.plansContainer = document.getElementById(plansContainerId);
    this.hoursContainer = document.getElementById(hoursContainerId);
    this.contactContainer = document.getElementById(contactContainerId);
    this.enquiryModal = document.getElementById(enquiryModalId);
    this.onEnquirySubmitted = onEnquirySubmitted;
    this.plans = [];
    this.gymProfile = null;
  }

  async init() {
    this.setupEnquiryModal();
    await this.loadData();
  }

  async loadData() {
    // Show loading state if containers exist
    if (this.plansContainer) {
      this.plansContainer.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: #a1a1aa;">
          <span style="display: inline-block; animation: spin 1s linear infinite; margin-right: 8px;">⏳</span> Loading live membership tiers...
        </div>
      `;
    }

    try {
      const [plansRes, gymRes] = await Promise.all([
        api.getMembershipPlans({ activeOnly: true }),
        api.getGymInfo(),
      ]);

      this.plans = (plansRes.success && plansRes.data) ? plansRes.data : [];
      this.gymProfile = (gymRes.success && gymRes.data) ? gymRes.data : (gymRes.data || null);

      this.renderPlans();
      this.renderHours();
      this.renderContact();
    } catch (err) {
      console.warn('[MembershipSection] Error loading live data:', err);
      this.renderPlans();
      this.renderHours();
      this.renderContact();
    }
  }

  renderPlans() {
    if (!this.plansContainer) return;

    if (!this.plans || this.plans.length === 0) {
      this.plansContainer.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: #a1a1aa; background: #12141a; border-radius: 12px; border: 1px dashed #27272a;">
          <p>No active membership plans found. Please enquire at the front desk desk.</p>
          <button class="btn btn-green btn-enquire-plan" data-plan-name="General Membership" style="margin-top: 12px;">
            Submit General Enquiry
          </button>
        </div>
      `;
      const btn = this.plansContainer.querySelector('.btn-enquire-plan');
      if (btn) btn.addEventListener('click', () => this.openEnquiryModal('General Membership'));
      return;
    }

    this.plansContainer.innerHTML = this.plans.map((plan) => {
      const priceNum = typeof plan.price_inr === 'number' ? plan.price_inr : parseFloat(plan.price_inr || 0);
      const formattedPrice = `₹${priceNum.toLocaleString('en-IN')}`;
      const durationText = plan.duration_months === 1 ? '1 Month' : `${plan.duration_months} Months`;
      const periodText = plan.duration_months === 1 ? '/month' : plan.duration_months === 3 ? '/quarter' : plan.duration_months === 12 ? '/year' : `/${plan.duration_months} mos`;
      const badge = plan.badge_label || (plan.is_featured ? 'Popular' : null);
      const perks = Array.isArray(plan.perks) ? plan.perks : (typeof plan.perks === 'string' ? plan.perks.split(',').map(p => p.trim()) : []);

      return `
        <div class="plan-card ${plan.is_featured ? 'plan-featured' : ''}" role="article" aria-label="${plan.name} Plan">
          ${badge ? `<div class="plan-badge">${badge}</div>` : ''}
          <h4 class="plan-name">${plan.name}</h4>
          <div class="plan-price-wrap">
            <span class="plan-currency font-mono">${formattedPrice}</span>
            <span class="plan-period">${periodText}</span>
          </div>
          <p class="plan-duration">Validity: ${durationText}</p>

          <ul class="plan-perks-list">
            ${perks.map((perk) => `<li><span class="perk-check">✓</span> ${perk}</li>`).join('')}
          </ul>

          <button class="btn btn-green btn-block btn-enquire-plan" data-plan-id="${plan.id}" data-plan-name="${plan.name}">
            Enquire About ${plan.name}
          </button>
        </div>
      `;
    }).join('');

    // Attach click listeners to plan buttons
    this.plansContainer.querySelectorAll('.btn-enquire-plan').forEach((btn) => {
      btn.addEventListener('click', () => {
        const planName = btn.dataset.planName;
        this.openEnquiryModal(planName);
      });
    });
  }

  renderHours() {
    if (!this.hoursContainer) return;

    const profile = this.gymProfile;
    let hoursListHtml = '';

    if (profile?.operating_hours && Array.isArray(profile.operating_hours)) {
      hoursListHtml = profile.operating_hours.map((h) => {
        const dayLabel = h.day || h.days || 'Day';
        let timingLabel = '';
        let statusLabel = 'Open';
        let statusClass = 'text-green';

        if (h.is_closed) {
          timingLabel = 'Closed';
          statusLabel = 'Closed';
          statusClass = 'text-warning';
        } else if (h.open && h.close) {
          timingLabel = `${this.formatTime(h.open)} – ${this.formatTime(h.close)}`;
          statusLabel = h.close === '13:00' ? 'Half Day' : 'Open';
        } else if (h.timing) {
          timingLabel = h.timing;
          statusLabel = h.status || 'Open';
        } else {
          timingLabel = '06:00 AM – 10:00 PM';
        }

        return `
          <li class="hours-row">
            <span class="hours-days">${dayLabel}</span>
            <span class="hours-timing font-mono">${timingLabel}</span>
            <span class="hours-status ${statusClass} font-semibold">${statusLabel}</span>
          </li>
        `;
      }).join('');
    } else {
      hoursListHtml = `
        <li class="hours-row"><span class="hours-days">Monday – Friday</span><span class="hours-timing font-mono">06:00 AM – 10:00 PM</span><span class="hours-status text-green font-semibold">Open</span></li>
        <li class="hours-row"><span class="hours-days">Saturday</span><span class="hours-timing font-mono">06:00 AM – 09:00 PM</span><span class="hours-status text-green font-semibold">Open</span></li>
        <li class="hours-row"><span class="hours-days">Sunday</span><span class="hours-timing font-mono">07:00 AM – 01:00 PM</span><span class="hours-status text-warning font-semibold">Half Day</span></li>
      `;
    }

    this.hoursContainer.innerHTML = `
      <div class="card hours-card" aria-label="Facility Operating Hours">
        <div class="card-header">
          <div class="header-title">
            <span class="hours-icon" aria-hidden="true">⏱️</span>
            <h3>Operating Hours</h3>
          </div>
          <span class="badge badge-green">Open 7 Days</span>
        </div>

        <ul class="hours-timetable">
          ${hoursListHtml}
        </ul>
        <p class="hours-note">🏋️ Members with Platinum Annual passes enjoy 24/7 keycard access.</p>
      </div>
    `;
  }

  formatTime(timeStr) {
    if (!timeStr || !timeStr.includes(':')) return timeStr;
    const parts = timeStr.split(':');
    let hour = parseInt(parts[0], 10);
    const minute = parts[1] || '00';
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return `${hour.toString().padStart(2, '0')}:${minute} ${ampm}`;
  }

  renderContact() {
    if (!this.contactContainer) return;

    const profile = this.gymProfile || {};
    const address = profile.address || '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038';
    const phone = profile.phone || '+91 98765 43210';
    const email = profile.email || 'reception@pulsecorefitness.in';

    this.contactContainer.innerHTML = `
      <div class="card contact-card" aria-label="Gym Contact Details">
        <div class="card-header">
          <div class="header-title">
            <span class="contact-icon" aria-hidden="true">📍</span>
            <h3>Facility & Contact</h3>
          </div>
          <span class="badge badge-outline-green">Front Desk</span>
        </div>

        <div class="contact-items-list">
          <div class="contact-item">
            <span class="contact-item-icon">🏢</span>
            <div>
              <strong class="contact-item-title">Location</strong>
              <p class="contact-item-text">${address}</p>
            </div>
          </div>

          <div class="contact-item">
            <span class="contact-item-icon">📞</span>
            <div>
              <strong class="contact-item-title">Reception Hotline</strong>
              <p class="contact-item-text font-mono">
                <a href="tel:${phone}" class="link-green">${phone}</a>
              </p>
            </div>
          </div>

          <div class="contact-item">
            <span class="contact-item-icon">✉️</span>
            <div>
              <strong class="contact-item-title">Support Email</strong>
              <p class="contact-item-text font-mono">
                <a href="mailto:${email}" class="link-green">${email}</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEnquiryModal() {
    const modal = this.enquiryModal;
    if (!modal) return;

    const closeBtn = modal.querySelector('.modal-close-btn');
    const form = modal.querySelector('#enquiry-form');
    const planInput = modal.querySelector('#enquiry-plan-input');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeEnquiryModal());
    }

    // Close on outside overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeEnquiryModal();
    });

    // Close on ESC key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('active')) {
        this.closeEnquiryModal();
      }
    });

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Submitting...';
        }

        const enquiryData = {
          fullName: modal.querySelector('#enquiry-name').value.trim(),
          phone: modal.querySelector('#enquiry-phone').value.trim(),
          email: modal.querySelector('#enquiry-email').value.trim(),
          planName: planInput.value || 'General Membership',
          notes: modal.querySelector('#enquiry-notes').value.trim(),
        };

        const result = await api.submitEnquiry(enquiryData);

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Membership Enquiry';
        }

        this.closeEnquiryModal();
        form.reset();

        if (this.onEnquirySubmitted) {
          this.onEnquirySubmitted(result.message || 'Enquiry submitted successfully!');
        }
      });
    }
  }

  openEnquiryModal(planName = 'General Membership') {
    if (!this.enquiryModal) return;
    const planInput = this.enquiryModal.querySelector('#enquiry-plan-input');
    const planTitle = this.enquiryModal.querySelector('#modal-plan-title');

    if (planInput) planInput.value = planName;
    if (planTitle) planTitle.textContent = planName;

    this.enquiryModal.classList.add('active');
    this.enquiryModal.setAttribute('aria-hidden', 'false');

    const firstInput = this.enquiryModal.querySelector('#enquiry-name');
    if (firstInput) firstInput.focus();
  }

  closeEnquiryModal() {
    if (!this.enquiryModal) return;
    this.enquiryModal.classList.remove('active');
    this.enquiryModal.setAttribute('aria-hidden', 'true');
  }
}
