#!/usr/bin/env python3
"""Build the Passphrases wordlists.

Source for the Wiktionary lists is the Kaikki.org (Wiktextract) raw data for the
English Wiktionary edition, one JSON object per word per language:

    https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz

Two stages, so filters can be changed without re-reading the 25 GB source:

    tools/build_wordlists.py extract   # .jsonl.gz -> cache/kaikki/entries.tsv
    tools/build_wordlists.py build     # entries.tsv -> src/wordlists + manifest

Standard library only. `extract` uses pigz or gzip to decompress.
"""

import argparse
import collections
import datetime
import json
import multiprocessing
import os
import re
import shutil
import subprocess
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'cache', 'kaikki')
RAW = os.path.join(CACHE, 'raw-wiktextract-data.jsonl.gz')
ENTRIES = os.path.join(CACHE, 'entries.tsv')
WORDLISTS = os.path.join(ROOT, 'src', 'wordlists')
BLOCKLIST = os.path.join(ROOT, 'tools', 'blocklist.txt')
MANIFEST = os.path.join(WORDLISTS, 'manifest.json')
SOURCE_URL = 'https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz'

# ---------------------------------------------------------------- extract ---

# Sense tags that matter to the filters, each reduced to one letter. A sense
# with none of them is written as "-".
SENSE_FLAGS = {
    'form-of': 'f', 'alt-of': 'a',
    'abbreviation': 'b', 'initialism': 'b', 'acronym': 'b',
    'romanization': 'r', 'misspelling': 'm',
    'obsolete': 'o', 'archaic': 'c',
    'vulgar': 'v', 'derogatory': 'd', 'offensive': 'x', 'slur': 's',
    'pejorative': 'p',
    'rare': 'R', 'dated': 'D', 'slang': 'S', 'no-gloss': 'n',
}


def extract_batch(lines):
    out = []
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        word = entry.get('word')
        lang = entry.get('lang')
        if not word or not lang:
            continue
        if '\t' in word or '\n' in word or '\t' in lang:
            continue
        senses = []
        for sense in entry.get('senses', ()):
            flags = {SENSE_FLAGS[t] for t in sense.get('tags', ())
                     if t in SENSE_FLAGS}
            if sense.get('form_of'):
                flags.add('f')
            if sense.get('alt_of'):
                flags.add('a')
            senses.append(''.join(sorted(flags)) or '-')
        out.append('%s\t%s\t%s\t%s\n' % (
            lang, word, entry.get('pos') or '', ','.join(senses)))
    return ''.join(out)


def cmd_extract(args):
    if not os.path.isfile(RAW):
        sys.exit('Missing %s\nDownload it from %s' % (RAW, SOURCE_URL))
    unzip = shutil.which('pigz') or shutil.which('gzip')
    proc = subprocess.Popen([unzip, '-dc', RAW], stdout=subprocess.PIPE,
                            bufsize=1 << 24)
    workers = args.jobs
    batch_lines = 2000
    total = 0
    tmp = ENTRIES + '.tmp'
    with multiprocessing.Pool(workers) as pool, \
            open(tmp, 'w', encoding='utf-8') as out:
        # Work in rounds so the reader cannot run ahead of the workers and
        # buffer the whole file in memory.
        while True:
            batches = []
            for _ in range(workers * 2):
                batch = []
                for line in proc.stdout:
                    batch.append(line)
                    if len(batch) >= batch_lines:
                        break
                if not batch:
                    break
                batches.append(batch)
            if not batches:
                break
            for text in pool.map(extract_batch, batches):
                out.write(text)
            total += sum(len(b) for b in batches)
            print('\r%d entries read' % total, end='', file=sys.stderr)
    print(file=sys.stderr)
    if proc.wait() != 0:
        sys.exit('Decompression failed; is the download complete?')
    os.replace(tmp, ENTRIES)
    print('Wrote %s' % ENTRIES)


# ------------------------------------------------------------------ build ---

KEEP_POS = {
    'noun', 'verb', 'adj', 'adv',
    'pron', 'num', 'prep', 'conj', 'det', 'intj', 'particle', 'postp',
    'article',
}
# A sense with any of these does not qualify a word: forms and alternative
# spellings, abbreviations, romanisations, misspellings, obsolete or archaic
# senses, and vulgar, derogatory, offensive, slur or pejorative senses.
NOT_LEMMA = set('fabrmocn') | set('vdxsp')

SKIP_LANGUAGES = {'Translingual'}
SKIP_PREFIXES = ('Proto-',)

MIN_LEN = 3
MIN_LEN_CJK = 2
MAX_LEN = 30
SHORT_BELOW = 8

# Lists that do not come from Wiktionary: (id, name, description, licence).
OTHER_LISTS = [
    ('securedrop', 'SecureDrop',
     'English wordlist from the SecureDrop project', ''),
    ('english-diceware', 'English Diceware',
     'Original English Diceware wordlist', ''),
    ('eowl', 'English Open Word List',
     'The English Open Word List. Copyright © J Ross Beresford 1993-1999. '
     'All Rights Reserved.', 'See eowl_license.txt'),
    ('catalan-diceware', 'Catalan Diceware',
     'Diccionari català per Marcel Hernandez', 'CC BY 4.0'),
    ('german-diceware', 'Deutsch Diceware',
     'Deutsch Wörterbuch, von Benjamin Tenne', 'GPL'),
    ('french-diceware', 'Français Diceware',
     'Dictionnaire français par Matthieu Weber', ''),
    ('italian-diceware', 'Italiano Diceware',
     'Lista di parole Diceware in Italiano by Tarin Gamberini', 'GPL'),
    ('japanese-diceware', 'Japanese Diceware',
     'Japanese Diceware by Hiroshi Yuki & J Greely', 'CC BY-SA'),
    ('dutch-diceware', 'Dutch Diceware',
     'Nederlands woordenboek door Bart Van den Eynde', 'GPL'),
    ('polish-diceware', 'Polski Diceware',
     'Polski Słownik przez Piotr (DrFugazi) Tarnowski', ''),
    ('swedish-diceware', 'Svensk Diceware',
     'Svensk ordbok av Magnus Bodin', ''),
]


def load_blocklist():
    """Slurs and vulgar words to keep out of every list, lowercased."""
    words = set()
    with open(BLOCKLIST, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                words.add(unicodedata.normalize('NFC', line).lower())
    return words


def decode_line(raw):
    """Decode UTF-8; a few lines in the old bundled lists are Windows-1252."""
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return raw.decode('cp1252', 'replace')


def is_cjk(ch):
    o = ord(ch)
    return (0x3040 <= o <= 0x30ff or 0x3400 <= o <= 0x4dbf
            or 0x4e00 <= o <= 0x9fff or 0xac00 <= o <= 0xd7af
            or 0xf900 <= o <= 0xfaff or 0x20000 <= o <= 0x323af)


def clean_word(raw):
    """Return the normalised word, or None if its shape is not acceptable."""
    word = unicodedata.normalize('NFC', raw)
    n = len(word)
    if n > MAX_LEN or n < MIN_LEN_CJK:
        return None
    if n < MIN_LEN and not is_cjk(word[0]):
        return None
    for i, ch in enumerate(word):
        cat = unicodedata.category(ch)
        if cat[0] not in 'LM':
            return None
        if i and cat == 'Lu':
            return None
    if unicodedata.category(word[0])[0] != 'L':
        return None
    return unicodedata.normalize('NFC', word.lower())


def slugify(name):
    text = unicodedata.normalize('NFKD', name)
    text = ''.join(c for c in text if not unicodedata.combining(c))
    text = text.encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def write_list(path, words):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        for w in words:
            f.write(w)
            f.write('\n')


def read_entries():
    """Per language, the set of acceptable headwords."""
    lemmas = collections.defaultdict(set)
    with open(ENTRIES, encoding='utf-8') as f:
        for line in f:
            parts = line.rstrip('\n').split('\t')
            if len(parts) != 4:
                continue
            lang, raw, pos, senses = parts
            if pos not in KEEP_POS:
                continue
            if lang in SKIP_LANGUAGES or lang.startswith(SKIP_PREFIXES):
                continue
            word = clean_word(raw)
            if word is None:
                continue
            if any(not set(sense) & NOT_LEMMA for sense in senses.split(',')
                   if sense):
                lemmas[lang].add(word)
    return lemmas


def cmd_build(args):
    if not os.path.isfile(ENTRIES):
        sys.exit('Missing %s; run the extract stage first.' % ENTRIES)
    lemmas = read_entries()
    blocklist = load_blocklist()
    source_date = datetime.date.fromtimestamp(
        os.path.getmtime(RAW)).isoformat() if os.path.isfile(RAW) else ''

    lists = []
    removed_log = []

    # Lists that do not come from Wiktionary: tidy them in place.
    for list_id, name, description, licence in OTHER_LISTS:
        path = os.path.join(WORDLISTS, list_id + '.wordlist')
        with open(path, 'rb') as f:
            raw_words = [decode_line(b) for b in f.read().split(b'\n')]
        seen = set()
        words = []
        for w in raw_words:
            w = unicodedata.normalize('NFC', w.strip())
            if not w or w in seen:
                continue
            if w.lower() in blocklist:
                removed_log.append((list_id, w))
                continue
            seen.add(w)
            words.append(w)
        write_list(path, words)
        lists.append({
            'id': list_id, 'file': list_id + '.wordlist', 'name': name,
            'description': description, 'count': len(words),
            'license': licence, 'source': 'bundled',
        })

    # Wiktionary lists.
    report = []
    wanted = {}
    slugs = {}
    for lang in sorted(lemmas):
        words = {w for w in lemmas[lang] if w not in blocklist}
        full = sorted(words)
        short = [w for w in full if len(w) < SHORT_BELOW]
        slug = slugify(lang)
        keep_full = len(full) >= args.min_words and bool(slug)
        keep_short = len(short) >= args.min_words and bool(slug)
        report.append((lang, slug, len(full), len(short), keep_full,
                       keep_short))
        if not (keep_full or keep_short):
            continue
        if slug in slugs:
            sys.exit('File name clash: %s and %s' % (lang, slugs[slug]))
        slugs[slug] = lang
        variants = (
            (keep_full, '-wiktionary', '%s Wiktionary', full),
            (keep_short, '-wiktionary-short', '%s Short-Word Wiktionary',
             short),
        )
        for keep, suffix, name, variant_words in variants:
            if not keep:
                continue
            list_id = slug + suffix
            wanted[list_id + '.wordlist'] = variant_words
            lists.append({
                'id': list_id, 'file': list_id + '.wordlist',
                'name': name % lang,
                'description': '%s words from Wiktionary' % lang,
                'count': len(variant_words), 'license': 'CC BY-SA',
                'source': 'wiktionary',
            })

    # Remove Wiktionary lists from earlier builds, then write the new ones.
    for fn in os.listdir(WORDLISTS):
        if fn.endswith('.wordlist') and '-wiktionary' in fn \
                and fn not in wanted:
            os.remove(os.path.join(WORDLISTS, fn))
    for fn, words in wanted.items():
        write_list(os.path.join(WORDLISTS, fn), words)

    manifest = {
        'generated': datetime.date.today().isoformat(),
        'min_words': args.min_words,
        'wiktionary_source': SOURCE_URL,
        'wiktionary_source_date': source_date,
        'lists': lists,
    }
    with open(MANIFEST, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write('\n')

    if args.report:
        os.makedirs(os.path.dirname(args.report), exist_ok=True)
        with open(args.report, 'w', encoding='utf-8') as f:
            f.write('language\tslug\twords\tshort_words\tfull_kept\t'
                    'short_kept\n')
            for row in sorted(report, key=lambda r: -r[2]):
                f.write('%s\t%s\t%d\t%d\t%s\t%s\n' % (
                    row[0], row[1], row[2], row[3],
                    'yes' if row[4] else 'no', 'yes' if row[5] else 'no'))
        with open(os.path.splitext(args.report)[0] + '-removed.tsv', 'w',
                  encoding='utf-8') as f:
            f.write('list\tword\n')
            for row in removed_log:
                f.write('%s\t%s\n' % row)

    print('%d lists in manifest (%d from Wiktionary); minimum %d words' % (
        len(lists), len(wanted), args.min_words))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('extract', help='reduce the Kaikki data to a table')
    p.add_argument('--jobs', type=int,
                   default=max(1, (os.cpu_count() or 2) - 2))
    p.set_defaults(func=cmd_extract)
    p = sub.add_parser('build', help='write wordlists and manifest')
    p.add_argument('--min-words', type=int, default=2048)
    p.add_argument('--report', help='write a per-language counts table here')
    p.set_defaults(func=cmd_build)
    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
