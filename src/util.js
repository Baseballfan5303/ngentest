const jsParser = require('acorn').Parser;
const indentJs = require('indent.js');

class Util {
  static get DEBUG () { return !!Util.__debug; }
  static set DEBUG (bool) { Util.__debug = bool; }

  static indent (str, prefix = '') {
    // const opts = Object.assign({ indent_size: 2 }, moreOpts);
    // return beautify(str, opts);
    str = indentJs.ts(str, { tabString: '  ' });
    str = str + prefix;
    str = str.replace(/\n/gm, '\n'+prefix);
    return str;
  }

  static objToJS (obj, level = 1) {
    const exprs = [];
    const indent = ' '.repeat(level * 2);
    if (typeof obj === 'function') {
      return `function() {\n` +
        `${indent}  return ${Util.objToJS(obj(), level + 2)};` +
        '\n' +
        `${indent}}`;
    } else if (Array.isArray(obj)) {
      return JSON.stringify(obj);
    } else {
      for (var key in obj) {
        if (!obj.hasOwnProperty(key)) { continue; }
        if (typeof obj[key] === 'object' && !Object.keys(obj[key])[0]) { // is empty obj, e.g. {}
          exprs.push(`${key}: '${key}'`);
        } else if (typeof obj[key] === 'object') {
          exprs.push(`${key}: ${Util.objToJS(obj[key], level + 1)}`);
        } else if (typeof obj[key] === 'function') {
          exprs.push(`${key} : ` +
            `function() {\n` +
            `${indent}  return ${Util.objToJS(obj[key](), level + 2)};` +
            '\n' +
            `${indent}}`);
        } else if (typeof obj[key] === 'string') {
          exprs.push(`${key}: "${obj[key]}"`);
        } else {
          exprs.push(`${key}: ${obj[key]}`);
        }
      }
      return '{\n' +
        exprs.map(el => { return `${indent}${el}`; }).join(',\n') +
        '\n' +
        indent.substr(2) + '}';
    }
  }

  /**
   * set value from source ONLY IF target value does not exists
   *
   * For example, assuming source is {foo: {bar: 1}}, and target is {foo: {baz: 2}}
   * AFter this function, target wil become { foo: {bar: 1, baz: 2}}
   */
  static assign (source, target) {
    const firstKey = Object.keys(source)[0];
    if (!target[firstKey]) {
      target[firstKey] = source[firstKey];
      return;
    }
    if (typeof source[firstKey] !== 'function') {
      Util.assign(source[firstKey], target[firstKey]);
    }
    return true;
  }

  static getNode (code) {
    const parsed = jsParser.parse(code);
    const firstNode = parsed.body[0];
    const node = firstNode.type === 'BlockStatement' ? firstNode.body[0] :
      firstNode.type === 'ExpressionStatement' ? firstNode.expression : null;
    return node;
  }

  /**
   * Returns expression members in array
   *
   * MemberExpression e.g., foo.bar().x -> [foo, bar, (), x]
   * CallExpression   e.g.  foo.x.bar() -> [foo, x, bar, ()]
   * ThisExpression   e.g.  this -> [this]
   * Identifier       e.g.  foo -> [foo]
   */
  static getExprMembers (node, result = []) {
    const { type, property, object, callee } = node;
    const member = /* eslint-disable */
      type === 'MemberExpression' ? property.name :
      type === 'CallExpression' ? `(${Util.getFuncArgNames(node)})` :
      type === 'ThisExpression' ? 'this' :
      type === 'Identifier' ? node.name : undefined;
    member && result.push(member); /* eslint-enable */

    if (object) {
      result = Util.getExprMembers(object, result);
    } else if (callee) {
      result = Util.getExprMembers(callee, result);
    }
    return result;
  }

  /**
   * Build a Javascript object from expression by parsing expression members
   *
   * MemberExpression     e.g., foo.bar.x().y
   *   returns {foo: {bar: x: function() { return {y: {}}}}}
   * Identifier           e.g., foo
   *   returns {}
   * LogicalExpresssion   e.g., foo.bar.x().y || a.b
   *   returns {foo: {bar: x: function() { return {y: {}}}}}
   */
  static getFuncArgNames (node) {
    const argNames = node.arguments.map(arg => {
      // console.log('......... arg ...........', arg);
      if (arg.params) {
        return arg.params[0].name;
      } else if (arg.type === 'ArrayExpression') {
        return `[]`;
      } else if (typeof arg.value !== 'undefined') {
        return arg.raw || arg.value;
      } else if (arg.type === 'Identifier' && arg.name) {
        return arg.name;
      } else if (arg.type === 'BinaryExpression') {
        return 'BIN_EXPR';
      } else if (arg.type === 'ObjectExpression') {
        return 'OBJ_EXPR';
      } else if (arg.type === 'MemberExpression') {
        return 'MBR_EXPR';
      } else {
        console.error('\x1b[31m%s\x1b[0m', `Invalid function argument expression`, arg);
        throw new Error('Invalid function argument type, ' + arg.type);
      }
    });
    return argNames.join(',');
  }

  static getFuncExprArg (node) {
    return node.arguments &&
      node.arguments[0] &&
      node.arguments[0].type.match(/FunctionExpression/) &&
      node.arguments[0];
  }

  /**
   * Build a Javascript object from expression by parsing expression members
   *
   * MemberExpression     e.g., foo.bar.x().y
   *   returns {foo: {bar: x: function() { return {y: {}}}}}
   * Identifier           e.g., foo
   *   returns {}
   * LogicalExpresssion   e.g., foo.bar.x().y || a.b
   *   returns {foo: {bar: x: function() { return {y: {}}}}}
   */
  static getObjectFromExpression (node, returns = {}) {
    const exprMembers = Util.getExprMembers(node);

    let nxt, obj;
    obj = exprMembers[0] && exprMembers[0].startsWith('(') ?
      function () { return returns; } : returns;
    exprMembers.forEach((str, ndx) => {
      nxt = exprMembers[ndx + 1];
      if (nxt && nxt.startsWith('(')) {
        const fnRet = { [str]: obj };
        obj = function () { return fnRet; };
      } else if (str && !str.startsWith('(')) {
        obj = { [str]: obj };
      }
    });

    return obj;
  }

  /**
   * if ends with something, return certain type.
   * e.g. for `foo.bar.substr(1)` , 'foo.bar' returns string
   * e.g. for 'foo.bar.subscribe(...)', 'foo.bar' returns Observable
   * e.g. for 'foo.bar.forEach(...)', 'foo.bar' returns array
   */
  static getExprReturn (node, classCode) {
    const code = classCode.substring(node.start, node.end);
    const getVars = function (node) {
      const members = Util.getExprMembers(node).reverse().join('.').replace(/\.\(/g, '(').split('.');
      let vars = [];
      let flagged;

      members.forEach(el => {
        if (flagged) {
          const lastIndex = vars.length - 1;
          vars[lastIndex] = vars[lastIndex] + '.' + el;
        } else {
          vars.push(el);
        }

        flagged = el.match(/\(/) ? true :
          el.match(/\)$/) ? false : flagged;
      });
      return vars;
    };

    // const members = Util.getExprMembers(node).reverse();
    const vars = getVars(node); // parenthesis taken care of array. 
    const baseCode = vars.join('.');
    const last = vars[vars.length - 1];

    try {
      jsParser.parse(baseCode);
    } catch (e) {
      throw new Error(`ERROR this JS code is invalid, "${baseCode}"`);
    }

    let ret;
    const funcExprArg = Util.getFuncExprArg(node);
    if (last.match(/(substr|replace|split)\(.*\)$/)) {
      ret = { code: baseCode, type: 'string', value: 'gentest' };
    } else if (last.match(/(subscribe)\(.*\)$/) && funcExprArg) {
      const funcCode = classCode.substring(funcExprArg.body.start, funcExprArg.body.end);
      const funcParam = Util.getFuncParamObj(funcExprArg, funcCode);
      const value = { type: 'Observable', value: funcParam || {} };

      ret = { code: baseCode, type: 'Observable', value };

    } else if (last.match(/(map|forEach|reduce|slice)\(.*\)$/) && funcExprArg) {

      ret = { code: baseCode, type: 'array', value: ['ngentest'] };

    } else {

      ret = { code: code, type: 'unknown', value: {} };

    }

    return ret;
  }

  /**
   *  Returns function param as an object from CallExpression
   *  e.g. 'foo.bar.x(event => { event.x.y.z() }' returns
   *    {x : { y: z: function() {} }}
   */
  static getFuncParamObj (node, code) { // CallExpression
    const funcRetName = node.params[0].name;
    const codeReplaced = code.replace(/\n+/g, '').replace(/\s+/g, ' ');
    const funcRetExprs = codeReplaced.match(new RegExp(`${funcRetName}(\\.[^\\s\\;]+)+`, 'ig'));

    const funcParam = {};
    (funcRetExprs || []).forEach(funcExpr => { // e.g., ['event.urlAfterRedirects.substr(1)', ..]
      const exprNode = Util.getNode(funcExpr);
      const newReturn = Util.getExprReturn(exprNode, funcExpr);
      const newCode = newReturn.code;
      const newValue = newReturn.value;
      const newNode = Util.getNode(newCode);
      const newObj = Util.getObjectFromExpression(newNode, newValue);
      const source = newObj[Object.keys(newObj)[0]];
      Util.assign(source, funcParam);
    });

    return funcParam;
  }

  /**
   * returns array of `this......` related codes from the node
   */
  static getThisExprs (node, allCode) {
    const code = allCode.substring(node.start, node.end);
    const code2 = code.replace(/\n+/g, '').replace(/\s+/g, ' ');
    const thisExprs = code2.match(new RegExp(`this(\\.[^\\s\\;]+)+`, 'ig'));
    return thisExprs;
  }

  /**
   * returns function parameter related codes from the node
   */
  static getParamExprs (node, paramNames, allCode) {
    const code = allCode.substring(node.start, node.end);
    const code2 = code.replace(/\n+/g, '').replace(/\s+/g, ' ');
    const paramExprs = [];
    paramNames.forEach(paramName => {
      const matches = code2.match(new RegExp(`${paramName }(\\.[^\\s\\;]+)+`, 'ig'));
      paramExprs.push(matches);
    });

    return paramExprs.flat();
  }

  static getFuncMockJS (mockData, thisName = 'component') {
    const js = [];
    Object.entries(mockData.props).forEach(([key1, value]) => {
      const valueFiltered = Object.entries(value).filter( ([k, v]) => k !== 'undefined');
      valueFiltered.forEach(([key2, value2]) => {
        js.push(`${thisName}.${key1} = ${thisName}.${key1} || {}`);
        if (value2.type === 'Observable') {
          const obsRetVal = Util.objToJS(value2.value).replace(/\{\s+\}/gm, '{}');
          js.push(`${thisName}.${key1}.${key2} = observableOf(${obsRetVal})`);
        } else if (typeof value2 === 'function' && JSON.stringify(value2()) === '{}') {
          js.push(`${thisName}.${key1}.${key2} = jest.fn();`);
        } else if (typeof value2 === 'function') {
          const fnValue2 = Util.objToJS(value2).replace(/\{\s+\}/gm, '{}');
          js.push(`${thisName}.${key1}.${key2} = jest.fn().mockReturnValue(${fnValue2})`);
        } else if (Array.isArray(value2)) {
          // const fnValue2 = Util.objToJS(value2).replace(/\{\s+\}/gm, '{}');
          js.push(`${thisName}.${key1}.${key2} = ['gentest']`);
        } else {
          const objVal2Key = Object.keys(value2)[0];
          if (['map', 'forEach', 'reduce', 'slice'].includes(objVal2Key)) {
            js.push(`${thisName}.${key1}.${key2} = ['${key2}']`);
          } else if (['substr', 'replace', 'split'].includes(objVal2Key)) {
            js.push(`${thisName}.${key1}.${key2} = = '${key2}'`);
          } else {
            const objValue2 = Util.objToJS(value2).replace(/\{\s+\}/gm, '{}');
            if (objValue2 === '{}') {
              js.push(`${thisName}.${key1}.${key2} = '${key2}'`);
            } else {
              js.push(`${thisName}.${key1}.${key2} = ${objValue2}`);
            }
          }
        }
      });
    });
    Object.entries(mockData.globals).forEach(([key1, value]) => { // window, document
      Object.entries(value).forEach(([key2, value2]) => { // location
        if (typeof value2 === 'function') {
          js.push(`${key1}.${key2} = jest.fn()`);
        } else {
          Object.entries(value2).forEach(([key3, value3]) => { // location
            if (typeof value3 === 'function') {
              js.push(`${key1}.${key2}.${key3} = jest.fn()`);
            } else {
              const objValue3 = Util.objToJS(value3).replace(/\{\s+\}/gm, '{}');
              js.push(`${key1}.${key2}.${key3} = ${objValue3}`);
            }
          });
        }
      });
    });

    return js.length ? `${js.join(';\n')};` : '';
  }

  static getFuncParamJS (mockData) {
    const js = [];
    Object.entries(mockData.params).forEach(([key2, value2]) => {
      const value2Key = typeof value2 === 'object' && Object.keys(value2)[0];
      if (key2 === 'undefined') {
        // ignore this
      } else if (value2.type === 'Observable') {
        const obsRetVal = Util.objToJS(value2.value).replace(/\{\s+\}/gm, '{}');
        js.push(`observableOf(${obsRetVal})`);
      } else if (['substr', 'replace', 'split'].includes(value2Key)) {
        js.push(`'${key2}'`);
      } else if (typeof value2 === 'function') {
        const fnValue2 = Util.objToJS(value2).replace(/\{\s+\}/gm, '{}');
        js.push(`function() { return ${fnValue2}; }`);
      } else {
        const objValue2 = Util.objToJS(value2).replace(/\{\s+\}/gm, '{}');
        js.push(`${objValue2}`);
      }
    });
    return js.join(', ');
  }

}

module.exports = Util;
