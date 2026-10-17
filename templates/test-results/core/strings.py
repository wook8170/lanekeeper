"""Workbook text (sheet names, headers, notes) read from the plugin's locale files (keys `xlsx.*`)."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, '..', '..', '..', 'locales')
_cache = {}
_lang = ['ko']


def set_lang(lang):
    _lang[0] = lang if lang in ('ko', 'en') else 'ko'


def get_lang():
    return _lang[0]


def _load(lang):
    if lang not in _cache:
        with open(os.path.join(LOCALES, lang + '.json'), encoding='utf-8') as f:
            _cache[lang] = json.load(f)
    return _cache[lang]


def T(key, **kw):
    """Text for `xlsx.<key>` in the current language; {name} placeholders are filled from kw."""
    full = 'xlsx.' + key
    text = _load(_lang[0]).get(full)
    if text is None:
        text = _load('en').get(full, full)
    return text.format(**kw) if kw else text
