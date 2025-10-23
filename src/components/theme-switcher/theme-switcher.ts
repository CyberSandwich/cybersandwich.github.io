import { LitElement, TemplateResult, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { classicThemeIcon, darkThemeIcon } from './icons';

type ThemeOption = 'light' | 'dark';

const THEMES: Array<{ name: ThemeOption; label: string; icon: TemplateResult }> = [
        { name: 'light', label: 'Light', icon: classicThemeIcon },
        { name: 'dark', label: 'Dark', icon: darkThemeIcon },
];

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
        private readonly _doc = typeof document !== 'undefined' ? document.firstElementChild : null;

        @property({ type: String, reflect: true })
        theme: ThemeOption | null = null;

        protected firstUpdated(): void {
                this._getCurrentTheme();
        }

        private _getCurrentTheme(): void {
                if (typeof localStorage === 'undefined') {
                        this._setTheme('dark');
                        return;
                }

                const storedTheme = localStorage.getItem('theme');

                if (storedTheme !== null) {
                        const legacyLightThemes = new Set(['default', 'earth', 'ocean', 'sand']);
                        const normalizedTheme = legacyLightThemes.has(storedTheme)
                                ? 'light'
                                : (storedTheme as ThemeOption);
                        const isValidTheme = normalizedTheme === 'light' || normalizedTheme === 'dark';

                        this._setTheme(isValidTheme ? normalizedTheme : 'dark');
                } else {
                        this._setTheme('dark');
                }
        }

        private _setTheme(theme: ThemeOption): void {
                this._doc?.setAttribute('data-theme', theme);

                const heroImage = document.querySelector('#home-hero-image') as HTMLImageElement | null;
                if (heroImage) {
                        heroImage.src = '/assets/images/home/DS Headshot.jpeg';
                }

                if (typeof localStorage !== 'undefined') {
                        localStorage.setItem('theme', theme);
                }

                this.theme = theme;
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
