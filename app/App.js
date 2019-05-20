// @flow
import React, { Component } from 'react';
import { observer } from 'mobx-react';
import { ThemeProvider } from 'react-polymorph/lib/components/ThemeProvider';
import { Router } from 'react-router-dom';
import { addLocaleData, IntlProvider } from 'react-intl';
import en from 'react-intl/locale-data/en';
import ko from 'react-intl/locale-data/ko';
import ja from 'react-intl/locale-data/ja';
import zh from 'react-intl/locale-data/zh';
import ru from 'react-intl/locale-data/ru';
import de from 'react-intl/locale-data/de';
import fr from 'react-intl/locale-data/fr';
import id from 'react-intl/locale-data/id';
import es from 'react-intl/locale-data/es';
import { Routes } from './Routes';
import { yoroiPolymorphTheme } from './themes/PolymorphThemes';
import { themeOverrides } from './themes/overrides';
import translations from './i18n/translations';
import type { StoresMap } from './stores';
import type { ActionsMap } from './actions';
import ThemeManager from './ThemeManager';
import environment from './environment';
import { hot } from 'react-hot-loader';

// https://github.com/yahoo/react-intl/wiki#loading-locale-data
addLocaleData([...en, ...ko, ...ja, ...zh, ...ru, ...de, ...fr, ...id, ...es]);

@observer
class App extends Component<{
  stores: StoresMap,
  actions: ActionsMap,
  history: Object,
}> {

  mobxDevToolsInstanceIfDevEnv(): ?React$Element<any> {
    if (!environment.isDev()) return undefined;
    try {
      const mobxDevToolsPackage = require('mobx-react-devtools').default;
      return React.createElement(mobxDevToolsPackage, {
        position: 'topRight'
      });
    } catch (err) {
      return undefined;
    }
  }

  render() {
    const { stores, actions, history } = this.props;
    const locale = stores.profile.currentLocale;

    // Merged english messages with selected by user locale messages
    // In this case all english data would be overridden to user selected locale, but untranslated
    // (missed in object keys) just stay in english
    const mergedMessages = Object.assign({}, translations['en-US'], translations[locale]);

    const themeVars = stores.profile.currentThemeVars;
    const currentTheme = stores.profile.currentTheme;
    const mobxDevTools = this.mobxDevToolsInstanceIfDevEnv();

    return (
      <div className={currentTheme} style={{ height: '100%' }}>
        <ThemeManager variables={themeVars} />

        {/* Automatically pass a theme prop to all componenets in this subtree. */}
        <ThemeProvider
          key={currentTheme}
          theme={yoroiPolymorphTheme}
          themeOverrides={themeOverrides(currentTheme)}
        >
          <IntlProvider {...{ locale, key: locale, messages: mergedMessages }}>
            <Router history={history}>
              {Routes(stores, actions)}
            </Router>
          </IntlProvider>
        </ThemeProvider>
        {mobxDevTools}
      </div>
    );
  }
}

export default hot(module)(App);
