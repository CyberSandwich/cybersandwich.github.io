import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  classicThemeIcon,
  darkThemeIcon,
} from './icons';

@customElement('theme-switcher')
export class ThemeSwitcher extends LitElement {
  static styles = [
    css`
      :host {
        display: inline-flex;
      }
      .theme-toggle {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 3.5rem;
        height: 1.875rem;
        padding: 0;
        border-radius: 999px;
        border: 1px solid var(--theme-outline-variant, var(--theme-outline));
        background: var(--theme-surface);
        background: color-mix(in srgb, var(--theme-surface) 90%, transparent);
        cursor: pointer;
        transition: background var(--theme-transition),
          border var(--theme-transition),
          box-shadow var(--theme-transition);
      }
      .theme-toggle:focus-visible {
        outline: 2px solid var(--theme-primary);
        outline-offset: 2px;
      }
      .theme-toggle__icons {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 0.4rem;
        pointer-events: none;
      }
      .theme-toggle__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1rem;
        height: 1rem;
        color: var(--theme-on-bg);
        opacity: 0.64;
        transition: opacity var(--theme-transition);
      }
      :host([theme='light']) .theme-toggle__icon--light,
      :host([theme='dark']) .theme-toggle__icon--dark {
        opacity: 1;
      }
      .theme-toggle__thumb {
        position: absolute;
        top: 0.2rem;
        left: 0.2rem;
        width: 1.45rem;
        height: 1.45rem;
        border-radius: 999px;
        background: var(--theme-bg);
        box-shadow: 0 4px 10px rgb(0 0 0 / 0.2);
        transition: transform var(--theme-transition);
      }
      :host([theme='dark']) .theme-toggle {
        background: var(--theme-primary);
        background: color-mix(in srgb, var(--theme-primary) 50%, transparent);
        border-color: var(--theme-primary);
        box-shadow: 0 0 0.75rem rgb(0 0 0 / 0.25);
      }
      :host([theme='dark']) .theme-toggle__thumb {
        transform: translateX(1.6rem);
      }
    `,
  ];

  // set the _doc element
  private _doc = document.firstElementChild;

  @property({ type: String, reflect: true })
  theme: string | null = null;

  private _getCurrentTheme() {
    // check for a local storage theme first
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme !== null) {
      const legacyLightThemes = new Set([
        'default',
        'earth',
        'ocean',
        'sand',
      ]);
      const normalizedTheme = legacyLightThemes.has(storedTheme)
        ? 'light'
        : storedTheme;
      const isValidTheme = normalizedTheme === 'light' || normalizedTheme === 'dark';

      this._setTheme(isValidTheme ? normalizedTheme : 'dark');
    } else {
      this._setTheme('dark');
    }
  }

  firstUpdated() {
    this._getCurrentTheme();
  }

  private _setTheme(theme: string) {
    this._doc?.setAttribute('data-theme', theme);

    const _heroImage = document.querySelector('#home-hero-image') as
      | HTMLImageElement
      | null;
    if (_heroImage) {
      _heroImage.src = '/assets/images/home/DS Headshot.jpeg';
    }
    localStorage.setItem('theme', theme);
    this.theme = theme;
  }

  private _toggleTheme() {
    const nextTheme = this.theme === 'light' ? 'dark' : 'light';
    this._setTheme(nextTheme);
  }

  render() {
    return html`
      <button
        class="theme-toggle"
        type="button"
        role="switch"
        aria-checked=${this.theme === 'dark'}
        title="Toggle color theme"
        aria-label="Toggle color theme"
        @click=${this._toggleTheme}
      >
        <span class="theme-toggle__icons" aria-hidden="true">
          <span class="theme-toggle__icon theme-toggle__icon--light">${classicThemeIcon}</span>
          <span class="theme-toggle__icon theme-toggle__icon--dark">${darkThemeIcon}</span>
        </span>
        <span class="theme-toggle__thumb" aria-hidden="true"></span>
      </button>
    `;
  }
}
