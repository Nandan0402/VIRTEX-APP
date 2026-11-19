/**
 * chatInterface.js - Conversational Dialogue & Answer Display Component
 * Renders user queries, receptionist answers, gesture tags, and dynamic "Speak" audio replay triggers
 */

export class ChatInterfaceComponent {
  constructor({ containerId, onSendMessage, onSpeakMessage, onTriggerGesture }) {
    this.container = document.getElementById(containerId);
    this.onSendMessage = onSendMessage;
    this.onSpeakMessage = onSpeakMessage;
    this.onTriggerGesture = onTriggerGesture;
    this.messages = [];
  }

  addMessage(sender, text, gesture = null, language = 'en-IN') {
    const messageObj = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      sender, // 'user' | 'robot'
      text,
      gesture,
      language,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    this.messages.push(messageObj);
    this.render();
    return messageObj;
  }

  getLatestRobotMessage() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].sender === 'robot') {
        return this.messages[i];
      }
    }
    return null;
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="chat-container" role="region" aria-label="Conversation with the receptionist">
        <div class="chat-messages" id="chat-messages-list" role="log" aria-live="polite">
          ${this.messages
            .map(
              (m) => `
            <article class="chat-bubble ${m.sender === 'user' ? 'bubble-user' : 'bubble-robot'}" tabindex="0">
              <div class="bubble-header">
                <span class="bubble-author">
                  ${m.sender === 'user' ? '👤 Member' : '💬 Virtex Receptionist'}
                </span>
                <span class="bubble-time">${m.time}</span>
              </div>
              
              <div class="bubble-body">
                <p class="bubble-text">${this.escapeHtml(m.text)}</p>
              </div>

              <div class="bubble-footer">
                ${
                  m.sender === 'robot'
                    ? `<button class="btn-bubble-speak" data-text="${encodeURIComponent(m.text)}" data-lang="${m.language}" aria-label="Speak this answer aloud" title="Speak this answer aloud">
                        🔊 Speak
                      </button>`
                    : ''
                }
              </div>
            </article>
          `
            )
            .join('')}
        </div>
      </div>
    `;

    // Attach speak button clicks
    this.container.querySelectorAll('.btn-bubble-speak').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = decodeURIComponent(btn.dataset.text);
        const lang = btn.dataset.lang || 'en-IN';
        if (this.onSpeakMessage) {
          this.onSpeakMessage(text, lang);
        }
      });
    });

    // Auto-scroll to bottom of conversation
    const list = this.container.querySelector('#chat-messages-list');
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
