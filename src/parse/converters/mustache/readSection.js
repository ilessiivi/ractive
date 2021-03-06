import {
  ALIAS,
  AWAIT,
  CATCH,
  ELSE,
  ELSEIF,
  SECTION,
  SECTION_IF,
  SECTION_UNLESS,
  THEN
} from 'config/types';
import { READERS } from 'parse/_parse';
import readClosing from './section/readClosing';
import readInlineBlock from './section/readInlineBlock';
import handlebarsBlockCodes from './handlebarsBlockCodes';
import readExpression from '../readExpression';
import refineExpression from 'parse/utils/refineExpression';
import { readAlias, readAliases } from './readAliases';
import { keys } from 'utils/object';
import { name } from '../expressions/shared/patterns';

const indexRefPattern = /^\s*:\s*([a-zA-Z_$][a-zA-Z_$0-9]*)/;
const keyIndexRefPattern = /^\s*,\s*([a-zA-Z_$][a-zA-Z_$0-9]*)/;
const handlebarsBlockPattern = new RegExp('^(' + keys(handlebarsBlockCodes).join('|') + ')\\b');

export default function readSection(parser, tag) {
  let expression,
    section,
    child,
    children,
    hasElse,
    block,
    unlessBlock,
    closed,
    i,
    expectedClose,
    hasThen,
    hasCatch,
    inlineThen;
  let aliasOnly = false;

  const start = parser.pos;

  if (parser.matchString('^')) {
    // watch out for parent context refs - {{^^/^^/foo}}
    if (parser.matchString('^/')) {
      parser.pos = start;
      return null;
    }
    section = { t: SECTION, f: [], n: SECTION_UNLESS };
  } else if (parser.matchString('#')) {
    section = { t: SECTION, f: [] };

    if (parser.matchString('partial')) {
      parser.pos = start - parser.standardDelimiters[0].length;
      parser.error(
        'Partial definitions can only be at the top level of the template, or immediately inside components'
      );
    }

    if ((block = parser.matchString('await'))) {
      expectedClose = block;
      section.t = AWAIT;
    } else if ((block = parser.matchPattern(handlebarsBlockPattern))) {
      expectedClose = block;
      section.n = handlebarsBlockCodes[block];
    }
  } else {
    return null;
  }

  parser.sp();

  if (block === 'with') {
    const aliases = readAliases(parser);
    if (aliases) {
      aliasOnly = true;
      section.z = aliases;
      section.t = ALIAS;
    }
  } else if (block === 'each') {
    const alias = readAlias(parser);
    if (alias) {
      section.z = [{ n: alias.n, x: { r: '.' } }];
      expression = alias.x;
    }
  }

  if (!aliasOnly) {
    if (!expression) expression = readExpression(parser);

    if (!expression) {
      parser.error('Expected expression');
    }

    // extra each aliases
    if (block === 'each' && parser.matchString(',')) {
      const aliases = readAliases(parser);
      if (aliases) {
        if (section.z) aliases.unshift(section.z[0]);
        section.z = aliases;
      }
    }

    // optional index and key references
    if ((block === 'each' || !block) && (i = parser.matchPattern(indexRefPattern))) {
      let extra;

      if ((extra = parser.matchPattern(keyIndexRefPattern))) {
        section.i = i + ',' + extra;
      } else {
        section.i = i;
      }
    } else if (block === 'await' && parser.matchString('then')) {
      parser.sp();
      hasThen = true;
      inlineThen = parser.matchPattern(name);
      if (!inlineThen) inlineThen = true;
    }

    if (!block && expression.n) {
      expectedClose = expression.n;
    }
  }

  parser.sp();

  if (!parser.matchString(tag.close)) {
    parser.error(`Expected closing delimiter '${tag.close}'`);
  }

  parser.sectionDepth += 1;
  children = section.f;

  let pos;
  do {
    pos = parser.pos;
    if ((child = readClosing(parser, tag))) {
      if (expectedClose && child.r !== expectedClose) {
        if (!block) {
          if (child.r)
            parser.warn(
              `Expected ${tag.open}/${expectedClose}${tag.close} but found ${tag.open}/${child.r}${
                tag.close
              }`
            );
        } else {
          parser.pos = pos;
          parser.error(`Expected ${tag.open}/${expectedClose}${tag.close}`);
        }
      }

      parser.sectionDepth -= 1;
      closed = true;
    } else if (
      !aliasOnly &&
      ((child = readInlineBlock(parser, tag, 'elseif')) ||
        (child = readInlineBlock(parser, tag, 'else')) ||
        (block === 'await' &&
          ((child = readInlineBlock(parser, tag, 'then')) ||
            (child = readInlineBlock(parser, tag, 'catch')))))
    ) {
      if (section.n === SECTION_UNLESS) {
        parser.error('{{else}} not allowed in {{#unless}}');
      }

      if (hasElse) {
        if (child.t === ELSE) {
          parser.error('there can only be one {{else}} block, at the end of a section');
        } else if (child.t === ELSEIF) {
          parser.error('illegal {{elseif...}} after {{else}}');
        }
      }

      if (!unlessBlock && (inlineThen || !hasThen) && !hasCatch) {
        if (block === 'await') {
          const s = { f: children };
          section.f = [s];
          if (inlineThen) {
            s.t = THEN;
            inlineThen !== true && (s.n = inlineThen);
          } else {
            s.t = SECTION;
          }
        } else {
          unlessBlock = [];
        }
      }

      const mustache = {
        t: SECTION,
        f: (children = [])
      };

      if (child.t === ELSE) {
        if (block === 'await') {
          section.f.push(mustache);
          mustache.t = ELSE;
        } else {
          mustache.n = SECTION_UNLESS;
          unlessBlock.push(mustache);
        }
        hasElse = true;
      } else if (child.t === ELSEIF) {
        mustache.n = SECTION_IF;
        refineExpression(child.x, mustache);
        unlessBlock.push(mustache);
      } else if (child.t === THEN) {
        if (hasElse) parser.error('{{then}} block must appear before any {{else}} block');
        if (hasCatch) parser.error('{{then}} block must appear before any {{catch}} block');
        if (hasThen) parser.error('there can only be one {{then}} block per {{#await}}');
        mustache.t = THEN;
        hasThen = true;
        child.n && (mustache.n = child.n);
        section.f.push(mustache);
      } else if (child.t === CATCH) {
        if (hasElse) parser.error('{{catch}} block must appear before any {{else}} block');
        if (hasCatch) parser.error('there can only be one {{catch}} block per {{#await}}');
        mustache.t = CATCH;
        hasCatch = true;
        mustache.n = child.n;
        section.f.push(mustache);
      }
    } else {
      child = parser.read(READERS);

      if (!child) {
        break;
      }

      children.push(child);
    }
  } while (!closed);

  if (unlessBlock) {
    section.l = unlessBlock;
  }

  if (!aliasOnly) {
    refineExpression(expression, section);
  }

  if (block === 'await' && (inlineThen || !hasThen) && !hasCatch && !hasElse) {
    const s = { f: section.f };
    section.f = [s];
    if (inlineThen) {
      s.t = THEN;
      inlineThen !== true && (s.n = inlineThen);
    } else {
      s.t = SECTION;
    }
  }

  // TODO if a section is empty it should be discarded. Don't do
  // that here though - we need to clean everything up first, as
  // it may contain removeable whitespace. As a temporary measure,
  // to pass the existing tests, remove empty `f` arrays
  if (!section.f.length) {
    delete section.f;
  }

  return section;
}
