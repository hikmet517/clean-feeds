// for comment docs: https://jsdoc.app/

// Array.prototype.isEmpty = function() { return this.length == 0; };
// String.prototype.isEmpty = function() { return this.length == 0; };


const symbols = ['(', ')', '|', '&', '!'];

/**
 * Tokenizes string into list of tokens (string).
 * @param {string} input
 * @returns {string[]}
 */
function tokenize(input) {
  let tokens = [];
  let str = '';
  for (let i = 0; i < input.length; i++) {
    let c = input[i];

    // check whitespace
    if (c == ' ') {
      if (str.length > 0) {
        tokens.push(str);
        str = '';
      }
    }

    // check symbols
    else if (symbols.includes(c)) {
      if (str.length > 0) {
        tokens.push(str);
        str = '';
      }

      tokens.push(c);
    }

    // others
    else {
      str += c;
    }
  }

  // check remainings
  if (str.length > 0) {
    tokens.push(str);
  }
  return tokens;
}

function normalizeTokens(tokens) {
  let newTokens = [];
  for (let i=0; i<tokens.length-1; i++) {
    newTokens.push(tokens[i]);
    // both are tags
    if ( !symbols.includes(tokens[i]) && !symbols.includes(tokens[i+1]) ) {
      newTokens.push('&');
    }
    else if (!symbols.includes(tokens[i]) && tokens[i+1] === '!') {
      newTokens.push('&');
    }
  }
  newTokens.push(tokens[tokens.length-1]);
  return newTokens;
}

/**
 * Parses a simple expression that does not include parentheses.
 * @param {string[]} tokens
 * @returns {Object}
 */
function parseExprs(tokens) {
  // check 'NOT'
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] == '!') {
      if (i + 1 >= tokens.length) {
        console.error("parse error: '!' is in wrong place");
        return false;
      }
      tokens.splice(i, 2, { '!': tokens[i + 1] });
      i -= 2;
    }
  }

  // check 'AND'
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] == '&') {
      if (i - 1 < 0 || i + 1 >= tokens.length) {
        console.error("parse error: '&' has missing operands");
        return false;
      }
      tokens.splice(i - 1, 3, { '&': { left: tokens[i - 1], right: tokens[i + 1] } });
      i -= 3;
    }
  }

  // check 'OR'
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] == '|') {
      if (i - 1 < 0 || i + 1 >= tokens.length) {
        console.error("parse error: '|' has missing operands");
        return false;
      }
      tokens.splice(i - 1, 3, { '|': { left: tokens[i - 1], right: tokens[i + 1] } });
      i -= 3;
    }
  }

  // check errors
  if (tokens.length != 1) {
    console.error('parse error');
    for (let token of tokens) {
      if (typeof (token) != 'object') {
        console.error(`around token: '${token}'`);
      }
    }
    return false;
  }
  return tokens[0];
}


/**
 * Parses tokens into abstract syntax tree (object).
 * First it parses parentheses and when the expression
 * is simple it calls {@link parseExprs}.
 * @param {string[]} tokens
 * @returns {Object}
 */
function parse(tokens) {
  if (tokens.length == 0)
    return true;

  let stack = [];

  // find sub-expressions by checking parens
  for (let token of tokens) {
    if (token == ')') {
      let expr = [];
      let elem = '';
      while (true) {
        if (stack.length != 0) {
          elem = stack.pop();

          // found matching paren
          if (elem == '(') {
            expr.reverse();
            stack.push({ '()': parseExprs(expr) });
            break;
          }
          else
            expr.push(elem);
        }
        // stack is consumed, cannot found '(', raise error
        else {
          console.error("parse error: missing '('");
          return false;
        }
      }
    }
    else {
      stack.push(token);
    }
  }

  // we handled parens, so these are erroneous
  if (stack.includes('(') || stack.includes(')')) {
    console.error('parse error: missing or too many parentheses');
    return false;
  }

  return parseExprs(stack);
}

/**
 * Evaluate abstract syntax tree and returns filtered list.
 * Calls {@link handleAnd}, {@link handleOr}, {@link handleNot}, {@link handleTag}
 * when necessary.
 * `entries` should have 'tag' property.
 * @param {Object|string} ast
 * @param {Object[]} entries
 * @returns {Object[]}
 */
function evalAst(ast, entries, tagProperty) {
  // console.log("ast:", ast);
  if (typeof (ast) == 'object') {
    for (let [key, val] of Object.entries(ast)) {
      if (key === '()') {
        // console.log('recurse ()');
        return evalAst(val, entries, tagProperty);
      }

      if (key === 'left' || key === 'right') {
        // console.log(`recurse ${key}`);
        return evalAst(val, entries, tagProperty);
      }

      if (key === '&') {
        // console.log('handle &');
        return handleAnd(evalAst(val['left'], entries, tagProperty),
                         evalAst(val['right'], entries, tagProperty));
      }

      if (key === '|') {
        // console.log('handle |');
        return handleOr(evalAst(val['left'], entries, tagProperty),
                        evalAst(val['right'], entries, tagProperty));
      }

      if (key === '!') {
        // console.log('handle !');
        return handleNot(evalAst(val, entries, tagProperty), entries);
      }

      if (typeof (val) === 'string') {
        // console.log('handle tagg:', val);
        return handleTag(evalAst(val, entries, tagProperty), entries);
      }
    }
  }
  if (typeof (ast) === 'string') {
    // console.log('handle tag:', ast);
    return handleTag(ast, entries, tagProperty);
  }
  return ast;
}


/**
 * handle tag, returns the entries that include the `tag`.
 * `entries` should have 'tags' property
 * @param {string} word
 * @param {Object[]} entries
 * @returns {Object[]}
 */
function handleTag(word, entries, tagProperty) {
  let filtered = [];
  for (let entry of entries) {
    if (entry[tagProperty] && entry[tagProperty].includes(word)) {
      filtered.push(entry);
    }
  }
  return filtered;
}

/**
 * @param {Object[]} current
 * @param {Object[]} entries
 * @returns {Object[]}
 */
function handleNot(current, entries) {
  let filtered = [];
  for (let entry of entries) {
    if (!current.includes(entry)) {
      filtered.push(entry);
    }
  } return filtered;
}

/**
 * @param {Object[]} left
 * @param {Object[]} right
 * @returns {Object[]}
 */
function handleAnd(left, right) {
  let filtered = [];
  for (let entryLeft of left) {
    for (let entryRight of right) {
      if (entryLeft == entryRight) {
        filtered.push(entryLeft);
      }
    }
  }
  return filtered;
}

/**
 * @param {Object} left
 * @param {Object} right
 * @returns {Object[]}
 */
function handleOr(left, right) {
  let filtered = left;
  for (let entryRight of right) {
    if (!filtered.includes(entryRight)) {
      filtered.push(entryRight);
    }
  }
  return filtered;
}


/**
 * Does everything. Tokenize -> Parse -> Evaluate.
 * `input` is query string using boolean logic with symbols ['!', '&', '|', '(', ')']
 * `entries` is a list of objects that should have tags property
 * which stores a list of tags as string.
 *
 * @param {string} input
 * @param {Object[]} entries
 * @returns {Object[]}
 */
function queryFilter(input, entries, tagProperty) {
  let tokens = (tokenize(input));
  // console.log('TOKENS:', tokens);
  let normTokens = normalizeTokens(tokens);
  let ast = parse(normTokens);
  // console.log('AST:', ast);
  let result = evalAst(ast, entries, tagProperty);
  // console.log('RESULT:', result);
  return result;
}

export default queryFilter;

// ================ tests ================

// var entries = [
//   {
//     url: "https://sneak.berlin/feed.xml",
//     tags: ['dev', 'blog', 'security']
//   },
//   {
//     url: "http://cachestocaches.com/feed",
//     tags: ['dev', 'emacs']
//   },
//   {
//     url: "https://www.commitstrip.com/en/rss",
//     tags: ['dev', 'comic']
//   },
//   {
//     url: "https://planet.emacslife.com/atom.xml",
//     tags: ['emacs', 'dev', 'blog']
//   },
//   {
//     url: "https://arstechnica.com/rss",
//     tags: ['tech', 'news']
//   },
//   {
//     url: "https://www.reddit.com/r/linux/.rss",
//     tags: ['linux', 'reddit']
//   },
//   {
//     url: "https://www.newsinlevels.com/level/level-3/rss",
//     tags: ['english', 'news']
//   }
// ];

// queryFilter("(dev & emacs) | ((tech & news) & !linux) | reddit", entries, 'tags');
// queryFilter(" (news & tech) | (blog & (!security)) ", entries, 'tags');
// queryFilter("(news | blog) & !emacs", entries, 'tags');
