import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  lightThemeIcon,
  darkThemeIcon,
} from './icons';

const themes = [
  {
    name: 'light',
    icon: lightThemeIcon,
    label: 'Light',
  },
  {
    name: 'dark',
    icon: darkThemeIcon,
    label: 'Dark',
  },
];

@customElement('theme-switcher')
export class ThemeSwitcher extends LitElement {
	static styles = [
		css`
			:host {
				display: block;
			}
			button {
				display: inline-flex;
				outline: none;
				border: none;
				background-color: transparent;
				border: 2px solid transparent;
				border-radius: 20rem;
				padding: 1px;
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
                        .theme-switcher__container {
                                margin: 2rem 0;
                                display: grid;
                                grid-template-columns: repeat(2, minmax(0, 1fr));
                                gap: 1rem;
                                justify-items: center;
                        }
			.theme-select__container {
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
			}
			.theme-select__container p {
				font-size: var(--font-size-sm);
			}
		`,
	];

	// set the _doc element
	private _doc = document.firstElementChild;

	@property({ type: String })
	theme: string | null = null;

        private _normalizeTheme(theme: string | null) {
                if (!theme) {
                        return null;
                }

                const legacyLightThemes = new Set(['classic', 'default', 'earth', 'ocean', 'sand']);

                if (legacyLightThemes.has(theme)) {
                        return 'light';
                }

                return theme;
        }

        private _getCurrentTheme() {
                // check for a local storage theme first
                const storedTheme = localStorage.getItem('theme');
                if (storedTheme !== null) {
                        const normalizedTheme = this._normalizeTheme(storedTheme);
                        const isValidTheme =
                                normalizedTheme !== null &&
                                themes.some((theme) => theme.name === normalizedTheme);

                        this._setTheme(isValidTheme ? normalizedTheme : 'dark');
                } else {
                        this._setTheme('dark');
                }
        }

        firstUpdated() {
                this._getCurrentTheme();
        }

        private _setTheme(theme: string) {
                this._doc.setAttribute('data-theme', theme);

                const _heroImage = document.querySelector('#home-hero-image') as
                        HTMLImageElement | null;
                if (_heroImage) {
                        if (theme === 'light') {
                                _heroImage.src = '/assets/images/home/classic-hero.jpg';
                        }
                        if (theme === 'dark') {
                                _heroImage.src = '/assets/images/home/dark-hero.jpg';
                        }
                }
                localStorage.setItem('theme', theme);
                this.theme = theme;
        }

        render() {
                const themeButtons = html`${themes.map((theme) => {
                        return html`
                                <div class="theme-select__container">
                                        <button
                                                @click=${() => this._setTheme(theme.name)}
                                                ?active=${this.theme === theme.name}
                                                title=${`Enable ${theme.label} Theme`}
                                        >
                                                ${theme.icon}
                                        </button>
                                        <p>${theme.label}</p>
                                </div>
                        `;
                })}`;

                return html`
                        <div class="theme-switcher__container">
                                ${themeButtons}
                        </div>
                `;
        }
}
