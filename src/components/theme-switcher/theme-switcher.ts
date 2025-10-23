import { LitElement, TemplateResult, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { classicThemeIcon, darkThemeIcon } from './icons';
import {
        DEFAULT_THEME,
        LEGACY_LIGHT_THEMES,
        SUPPORTED_THEMES,
        THEME_STORAGE_KEY,
        type ThemeOption,
} from './constants';

const THEMES: Array<{ name: ThemeOption; label: string; icon: TemplateResult }> = [
        { name: 'light', label: 'Light', icon: classicThemeIcon },
        { name: 'dark', label: 'Dark', icon: darkThemeIcon },
];

const LEGACY_LIGHT_THEME_SET = new Set<string>(LEGACY_LIGHT_THEMES);
const SUPPORTED_THEME_SET = new Set<string>(SUPPORTED_THEMES);

@customElement('theme-switcher')
export class ThemeSwitcher extends LitElement {
        static styles = css`
                :host {
                        display: block;
                }
                .theme-switcher__container {
                        margin: 1.5rem 0 0;
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        gap: 1.5rem;
                        justify-items: center;
                }
                .theme-select__container {
                        display: flex;
                        flex-direction: row;
                        align-items: center;
                        justify-content: center;
                }
                button {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        outline: none;
                        border: none;
                        background-color: transparent;
                        border: 2px solid transparent;
                        border-radius: 20rem;
                        padding: 0.5rem;
                        cursor: pointer;
                        transition: border var(--theme-transition);
                }
                button[active] {
                        border: 2px solid var(--theme-primary);
                        box-shadow: 0 0 12px 1px var(--theme-primary);
                }
                button:hover {
                        border: 2px solid var(--theme-primary);
                }
        `;

        // set the _doc element
        private readonly _doc = typeof document !== 'undefined' ? document.documentElement : null;

        private heroImage: HTMLImageElement | null = null;

        @property({ type: String, reflect: true })
        theme: ThemeOption | null = null;

        protected firstUpdated(): void {
                this.heroImage = document.querySelector('#home-hero-image') as HTMLImageElement | null;
                this._applyStoredTheme();
        }

        private _applyStoredTheme(): void {
                const storedTheme = this._getStoredTheme();
                this._setTheme(storedTheme ?? DEFAULT_THEME);
        }

        private _getStoredTheme(): ThemeOption | null {
                const storedTheme = this._readStoredTheme();

                if (storedTheme === null) {
                        return null;
                }

                if (LEGACY_LIGHT_THEME_SET.has(storedTheme)) {
                        return DEFAULT_THEME;
                }

                return SUPPORTED_THEME_SET.has(storedTheme) ? (storedTheme as ThemeOption) : null;
        }

        private _readStoredTheme(): string | null {
                if (typeof window === 'undefined' || !('localStorage' in window)) {
                        return null;
                }

                try {
                        return window.localStorage.getItem(THEME_STORAGE_KEY);
                } catch (error) {
                        return null;
                }
        }

        private _setTheme(theme: ThemeOption): void {
                this._doc?.setAttribute('data-theme', theme);

                if (this.heroImage) {
                        this.heroImage.src = '/assets/images/home/DS Headshot.jpeg';
                }

                this._storeTheme(theme);

                this.theme = theme;
        }

        private _storeTheme(theme: ThemeOption): void {
                if (typeof window === 'undefined' || !('localStorage' in window)) {
                        return;
                }

                try {
                        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
                } catch (error) {
                        /* no-op */
                }
        }

        private _handleSelect(theme: ThemeOption): void {
                if (this.theme !== theme) {
                        this._setTheme(theme);
                }
        }

        render() {
                return html`
                        <div class="theme-switcher__container" role="radiogroup" aria-label="Theme selector">
                                ${THEMES.map((themeOption) => html`
                                        <div class="theme-select__container">
                                                <button
                                                        type="button"
                                                        role="radio"
                                                        aria-checked=${this.theme === themeOption.name}
                                                        @click=${() => this._handleSelect(themeOption.name)}
                                                        ?active=${this.theme === themeOption.name}
                                                        title=${`Enable ${themeOption.label} Theme`}
                                                        aria-label=${`Enable ${themeOption.label} Theme`}
                                                >
                                                        ${themeOption.icon}
                                                </button>
                                        </div>
                                `)}
                        </div>
                `;
        }
}

declare global {
        interface HTMLElementTagNameMap {
                'theme-switcher': ThemeSwitcher;
        }
}
