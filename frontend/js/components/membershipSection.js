/**
 * membershipSection.js - Renders Membership Plans, Enquiry Form, Opening Hours, and Contact Cards
 */

import { MEMBERSHIP_PLANS, GYM_INFO } from '../services/mockData.js';
import { api } from '../services/api.js';

export class MembershipSectionComponent {
  constructor({ plansContainerId, hoursContainerId, contactContainerId, enquiryModalId, onEnquirySubmitted }) {
    this.plansContainer = document.getElementById(plansContainerId);
    this.hoursContainer = document.getElementById(hoursContainerId);
    this.contactContainer = document.getElementById(contactContainerId);
    this.enquiryModal = document.getElementById(enquiryModalId);
    this.onEnquirySubmitted = onEnquirySubmitted;
    this.selectedPlan = null;
  }

  init() {
    this.renderPlans();
    this.renderHours();
    this.renderContact();
    this.setupEnquiryModal();
  }

  renderPlans() {
    if (!this.plansContainer) return;

    this.plansContainer.innerHTML = MEMBERSHIP_PLANS.map(
      (plan) => `
      <div class="plan-card ${plan.featured ? 'plan-featured' : ''}" role="article" aria-label="${plan.name} Plan">
        ${plan.badge ? `<div class="plan-badge">${plan.badge}</div>` : ''}
        <h4 class="plan-name">${plan.name}</h4>
        <div class="plan-price-wrap">
          <span class="plan-currency font-mono">${plan.price}</span>
          <span class="plan-period">${plan.period}</span>
        </div>
        <p class="plan-duration">Validity: ${plan.duration}</p>

        <ul class="plan-perks-list">
          ${plan.perks.map((perk) => `<li><span class="perk-check">✓</span> ${perk}</li>`).join('')}
        </ul>

        <button class="btn btn-green btn-block btn-enquire-plan" data-plan-id="${plan.id}" data-plan-name="${plan.name}">
          Enquire About ${plan.name}
        </button>
      </div>
    `
    ).join('');

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
          ${GYM_INFO.hours
            .map(
              (h) => `
            <li class="hours-row">
              <span class="hours-days">${h.days}</span>
              <span class="hours-timing font-mono">${h.timing}</span>
              <span class="hours-status ${h.status === 'Open' ? 'text-green' : 'text-warning'} font-semibold">
                ${h.status}
              </span>
            </li>
          `
            )
            .join('')}
        </ul>
        <p class="hours-note">🏋️ Members with Platinum Annual passes enjoy 24/7 keycard access.</p>
      </div>
    `;
  }

  renderContact() {
    if (!this.contactContainer) return;

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
              <p class="contact-item-text">${GYM_INFO.address}</p>
            </div>
          </div>

          <div class="contact-item">
            <span class="contact-item-icon">📞</span>
            <div>
              <strong class="contact-item-title">Reception Hotline</strong>
              <p class="contact-item-text font-mono">
                <a href="tel:${GYM_INFO.phone}" class="link-green">${GYM_INFO.phone}</a>
              </p>
            </div>
          </div>

          <div class="contact-item">
            <span class="contact-item-icon">✉️</span>
            <div>
              <strong class="contact-item-title">Support Email</strong>
              <p class="contact-item-text font-mono">
                <a href="mailto:${GYM_INFO.email}" class="link-green">${GYM_INFO.email}</a>
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
          submitBtn.textContent = 'Submit Enquiry';
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

