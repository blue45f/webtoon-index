import {
  DICT,
  FALLBACK_LANG,
  FALLBACK_CHAIN,
  resolveTranslation,
} from "./i18n-core";

export * from "./i18n-core";
export * from "./i18n-locale-list";
export * from "./i18n-intl-utils";
export * from "./i18n-asset-loader";
export * from "./i18n-runtime-translation";
export {
  DICT as i18nDict,
  FALLBACK_LANG,
  FALLBACK_CHAIN,
  resolveTranslation as resolveI18nValue,
};
