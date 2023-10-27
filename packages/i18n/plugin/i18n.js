// @ts-nocheck
const { declare } = require('@babel/helper-plugin-utils');
const generate = require('@babel/generator').default;
const babelParser = require('@babel/parser');
const t = require('@babel/types');
const crypto = require('crypto-js');

/** babel files的相关操作 */
const AllText = 'allText';
const finalAction = 'finalAction';
const shouldFinalAction = 'noImport';
const babelPreFilesList = [
  [AllText, []],
  [finalAction, () => {}],
  [shouldFinalAction, false],
];
const fileAction = {
  set(file, key, newValue) {
    file.set(key, newValue);
  },
  get(file, key) {
    return file.get(key);
  },
};

const defaultOptions = {
  /** babel不支持返回自定义内容，需要通过callback拿到提取出来的{[hash-md5]:"中文内容"} */
  mappingCallbacks: (dict = {}) => {},
  /** babel解析后如果修改了源代码，则需要通过callback进行调用通知外部 */
  changeAstCallback: () => {},
  /** 导入国际化函数的import语句，将会在需要导入的文件最上面自动添加，比如： import {intl} from "@/utils/intl"*/
  injectIntlImport: '',
  /**
   * @description 得到需要替换后的国际化函数字符串,注意需要返回字符串而不是函数。
   * @warning 请注意，为了插件完整运行，国际化函数请和i18n规范一致，比如:
   * ```ts
   * export function getLangMsg(variable:string,params:object){
   *  return {
   *    toString(){
   *      return locals[variable]
   *    },
   *    d(defaultValue:string){
   *      return defaultValue
   *    }
   *  }
   * }
   * ```
   * @example
   * ```
   * getIntlFunc:(hash,sourceMsg)=>`getLangMsg(${hash}).default(${sourceMsg})`
   * const example="你好"+name
   * // 将会转换成
   * const example= getLangMsg("md5-hash",{arg0:name}).default(`你好${name}`);
   * //zh-CN.json
   * {
   *  "md5-hash":"你好{arg0}"
   * }
   * ```
   *  */
  getIntlFunc: (hash = 'md5', sourceMsg = '原本的中文') => {},
};
const formatOptionsKeys = Object.keys(defaultOptions);
/** 判断字符串中是否包含中文 */
const includesChinese = (v) => /[\u4e00-\u9fa5]/g.test(v);
/** 寻找父节点层级 */
function findParentLevel(path, callback, max = 2) {
  let count = 0;
  let myPath = path;
  while (count < max && (myPath = myPath.parentPath)) {
    count++;
    if (callback(myPath)) return myPath;
  }
  return null;
}
/** 获得字符串类型的值 */
const getStrPathValue = (path) => {
  let node = path;
  if (path.node) {
    node = path.node;
  }
  return node.value;
};
/** 获得模版字符串类型的值 */
const getTemStrPathValue = (path) => {
  let quasisList;
  if (path.get) {
    quasisList = path.get('quasis');
  } else {
    quasisList = path.quasis;
  }
  return quasisList
    .map((item) => getStrPathValue(item).raw)
    .reduce(
      (preStr, curStr, curIndex) =>
        // 因为是上一个，所以需要减1
        `${preStr}{arg${curIndex - 1}}${curStr}`,
    );
};
/** 转换成`value,{arg0:name}`的字符串  */
const getReplaceValue = (path, hash) => {
  // 首先提取出来变量->['name','title',...]
  const expressionParams = t.isTemplateLiteral(path)
    ? (path.node ? path.node : path).expressions.map((item) => generate(item).code)
    : [];
  // 转换成类似{arg0:name,arg1:title}的ast
  const expressionToAst = t.objectExpression(
    expressionParams.map((expression, index) =>
      t.objectProperty(t.identifier(`arg${index}`), t.identifier(expression)),
    ),
  );
  // 转换成`value,{arg0:name}`的字符串
  const replaceValue = `'${hash}',${expressionParams.length ? generate(expressionToAst).code : ''}`;
  return replaceValue;
};

/** 判断一个表达式ast是否包含字符串类型且包含中文 */
function isChainStringExpression(node) {
  if (t.isStringLiteral(node) && includesChinese(node.value)) {
    return true;
  }
  if (t.isBinaryExpression(node)) {
    return isChainStringExpression(node.left) || isChainStringExpression(node.right);
  }
  return false;
}
/** 将识别并转换好的中文字段保存到babel提供的store中，返回对应的key  */
function saveText(file, value, sourceValue) {
  const allTextList = fileAction.get(file, AllText);
  //HINT: 由于从字符串和jsxText中解析出的中文有些带有\n和无意义前后空格，这里需要删掉
  const modifyValue = value.toString().replace(/\n/g, '').trim(),
    modifySourceValue = sourceValue.toString().replace(/\n/g, '').trim();
  const md5 = crypto.MD5(modifySourceValue).toString().slice(0, 15);
  allTextList.push({
    key: md5,
    value: modifyValue,
  });
  fileAction.set(file, AllText, allTextList);
  return md5;
}
const pathAction = {
  checkSkip: (path) => path.node.skipTransform,
  setSkip: (path) => {
    path.node.skipTransform = true;
  },
};

const autoI18nPlugin = declare((api, options) => {
  api.assertVersion(7);
  if (formatOptionsKeys.some((propKey) => !Reflect.has(options, propKey))) {
    throw new Error(
      `options format error,please make sure options object includes ${formatOptionsKeys}!`,
    );
  }
  // 从options拿出来对应参数
  const intlImportString = options.injectIntlImport,
    getIntlFunc = options.getIntlFunc;
  // 解析一下传递的import语句，用于后续判断文件是否引入
  const intlImportAst = babelParser.parse(intlImportString, {
      sourceType: 'unambiguous',
    }).program.body[0],
    intlImportSpecifier = intlImportAst.specifiers[0],
    intlName = t.isImportDefaultSpecifier(intlImportSpecifier)
      ? intlImportSpecifier.local.name
      : intlImportSpecifier.imported.name;
  const intlFn = api.template.ast(getIntlFunc('', '')).expression,
    intlClsName = intlFn.callee.object.callee.name,
    intlPropName = intlFn.callee.property.name;
  /** 将目标ast转换成新的ast  */
  function getReplaceExpression(path, hash, sourceValue) {
    const replaceValue = getReplaceValue(path, hash);
    // 这里调用babel api转换成 getLangMsg('md5-hash:15').d("中文")的babel代码
    let replaceExpression = api.template.ast(getIntlFunc(replaceValue, sourceValue)).expression;
    // 以下全为判断在jsx中并且是否需要加上{}
    if (path.isJSXText?.()) {
      // 对应<div>中文</div>这种情况
      replaceExpression = api.types.jSXExpressionContainer(replaceExpression);
    } else if (path.findParent?.((p) => p.isJSXAttribute())) {
      if (
        !findParentLevel(path, (p) => p.isJSXExpressionContainer()) &&
        !findParentLevel(path, (p) => p.isLogicalExpression()) &&
        !findParentLevel(path, (p) => p.isConditionalExpression()) &&
        !findParentLevel(path, (p) => p.isBinaryExpression()) &&
        !findParentLevel(path, (p) => p.isCallExpression()) &&
        !findParentLevel(path, (p) => p.isObjectProperty(), 1) &&
        !findParentLevel(path, (p) => p.isVariableDeclarator()) &&
        !findParentLevel(path, (p) => p.isReturnStatement())
      ) {
        // 就是在外面包裹一层{}
        replaceExpression = api.types.jSXExpressionContainer(replaceExpression);
      }
    }

    return replaceExpression;
  }
  /** babel没有好的方法和外面交互，使用callback的方式通知外面这份文件需要变更 */
  function makeFlagToShowChangedAst(state) {
    fileAction.set(state.file, shouldFinalAction, true);
    options.changeAstCallback();
  }
  /** 集中处理ast */
  function resolveAst(path, state, value, sourceCode) {
    if (path.findParent((p) => p.isTSLiteralType())) {
      return;
    }
    if (pathAction.checkSkip(path) || !value || !includesChinese(value)) {
      return;
    }
    const md5Hash = saveText(state.file, value, sourceCode);
    const replaceExpression = getReplaceExpression(path, md5Hash, sourceCode);
    path.replaceWith(replaceExpression);
    makeFlagToShowChangedAst(state);
    path.skip();
  }

  return {
    /** 处理之前的准备操作 */
    pre(file) {
      /** 这里的file可以通过下面visitor.xxx(path,state)中的state.file拿到，相当于babel的store */
      // 初始化一下
      babelPreFilesList.map(([key, defaultValue]) => fileAction.set(file, key, defaultValue));
    },
    visitor: {
      Program: {
        /** 无论什么ast type都会执行这段,这段主要用于查看文件中是否import相关函数 */
        enter(path, state) {
          let imported = false;
          // 每一个traverse都可以看作一次单独的解析ast
          // 这段用于查询该文件内是否已导入相关api，未导入则自动在第一行导入。
          path.traverse({
            ImportDeclaration(p) {
              /** 判断import xxx from "@xxx"中的"@xxx"是否一致 */
              if (p.node.source.value !== intlImportAst.source.value) {
                return;
              }
              /** 判断import {xxx} from "@xx"中的"xxx"是否存在 */
              p.node.specifiers.some((node) => {
                // 默认导入,比如 import get from "lodash/get"
                if (t.isImportDefaultSpecifier(node) && node.local.name === intlName) {
                  imported = true;
                } // 具名导入,比如import {get} from "lodash"
                else if (t.isImportSpecifier(node) && node.imported.name === intlName) {
                  imported = true;
                } else {
                  return false;
                }
                return true;
              });
            },
          });
          /** 如果该文件没有导入过翻译函数 */
          if (!imported) {
            const importAst = api.template.ast(intlImportString);
            fileAction.set(state.file, finalAction, () => {
              path.node.body.unshift(importAst);
            });
          }
          // 这段用于判断前面有没有相关忽略注释，有则需要忽略这些转换操作。
          path.traverse({
            'StringLiteral|TemplateLiteral'(path) {
              path.node.leadingComments?.map((comment, index) => {
                if (comment.value.includes('i18n-disable')) {
                  path.node.skipTransform = true;
                }
              });
              if (path.findParent((p) => p.isImportDeclaration())) {
                path.node.skipTransform = true;
              }
            },
          });
        },
      },
      /** 处理函数情况，主要用于判断是否已经被国际化过 */
      CallExpression(path, state) {
        const fnPath = path.node.callee;
        if (
          t.isMemberExpression(fnPath) &&
          fnPath.property.name === intlPropName &&
          t.isCallExpression(fnPath.object) &&
          fnPath.object.callee.name === intlClsName
        ) {
          /** 已经被国际化的中文，此时中文被.d类似函数包裹，类型有字符串或者模版字符串两种，分别执行即可 */
          const innerChinese = path.node.arguments[0],
            innerHash = path.node.callee.object.arguments[0].value,
            isStringLiteral = t.isStringLiteral(innerChinese);
          if (isStringLiteral) {
            const value = innerChinese.value;
            const md5Hash = saveText(state.file, value, JSON.stringify(value));
            if (md5Hash !== innerHash) {
              path.node.callee.object.arguments[0].value = md5Hash;
              path.replaceWith(path);
            }
          } else {
            //模版字符串
            const value = getTemStrPathValue(innerChinese);
            const sourceCode = generate(innerChinese).code,
              md5Hash = saveText(state.file, value, sourceCode);
            if (md5Hash !== innerHash) {
              const newTempStrAst = api.template.ast(sourceCode).expression;
              const replaceExpression = getReplaceExpression(newTempStrAst, md5Hash, sourceCode);
              path.replaceWith(replaceExpression);
            }
          }
          path.skip();
          makeFlagToShowChangedAst(state);
        }
      },
      /** 必须单独处理object的key为中文的情况，否则将无法转换成功 */
      ObjectProperty(path, state) {
        /** 需要注意的是，这里也默认解析了ts的枚举类型
         * 比如 enum Title{
         *  HOME="首页",
         *  USER="个人"
         * }
         * 将会转换为
         * enum Title{
         *  HOME=getLangMsg('md5-hash:15').d("首页"),
         *  USER=getLangMsg('md5-hash:15').d("个人")
         * }
         * 这样解析会有typescript warning，但是按逻辑来说是正确的；因为我们可能会需要里面的值展示到UI上
         * 同时这样解析也能编译。
         * 但是注意像这种枚举
         * enum Title{
         * "首页"="首页",
         * "个人"="个人"
         * }
         * 是无法解析并且将直接报错退出的。应不使用这种枚举定义。
         */
        const keyNode = path.node.key;
        /** 如果key不是字符串或者模版字符串，退出 */
        if (!t.isStringLiteral(keyNode)) {
          return;
        }
        /** 不解析类型 */
        if (path.findParent((p) => p.isTSLiteralType())) {
          return;
        }
        const value = keyNode.value;
        /** 中文才转 */
        if (!includesChinese(value)) {
          return;
        }
        /**
         * 这里只做了一件事，就是将如const a={"这里是:":"中文","english":"english"}
         * 转换为const a={["这里是:"]:"中文","english":"english"}
         * 然后babel再调用下面针对字符串的回调进行处理
         */
        path.node.key = api.template.ast(`[${keyNode.extra.raw}]`).expression;
        path.replaceWith(path);
        makeFlagToShowChangedAst(state);
      },
      /** 处理操作符情况，只处理+；当有一边是字符串时，js执行字符串拼接 */
      BinaryExpression(path, state) {
        /** 当+号有一方是字符串时，js会进拼接；凭借这个特性我们可以将如'123'+name直接转换成`123${name}`
         * 需要注意的是因为仅进行国际化，所以还判断了有没有中文的情况。
         * 只有'你好'+name，这种才会转换；如'123'+name和’123‘+getName('小明')这种则不会转换
         */
        if (path.node.operator !== '+' || !isChainStringExpression(path.node)) {
          return;
        }
        /**由于babel会把1+2和1+2+3两种都看成是一个表达式，所以这里需要先解析表达式
         * 比如'123'+'你好'+name+'hello'解析成['123','你好',name,'hello']
         */
        function reducerBinary(node = path.node) {
          if (!t.isBinaryExpression(node)) {
            return [{ ...node }];
          }
          const arr = [];
          if (node.left) {
            arr.push(...reducerBinary(node.left));
          }
          if (node.right) {
            arr.push(...reducerBinary(node.right));
          }
          return arr;
        }
        /** 由于类似a+b+c+d会被babel解析成二叉树，所以需要先续遍历才能形成[a,b,c,d]的数组 */
        const binaryNodes = reducerBinary(path.node);
        /** 下面的代码就做了一件事，babel构造模版字符串时逻辑是这样的：
         * t.templateLiteral(['123','你好',''],[name,title])
         * ->'123'+name+'你好'+title+''
         * 所以第一个数组必须比第二个数组长度多一，第二个数组为插值，插入到第一个数组的间隙中。
         */

        const templateElements = [],
          templateExpressions = [];
        const createTempElement = (value = '', tail = false) =>
          t.templateElement({ raw: value, cooked: value }, tail);
        const pushTemplateElement = (value = '', tail = false) =>
          templateElements.push(createTempElement(value, tail));
        binaryNodes.map((node, index) => {
          const isLast = index === binaryNodes.length;
          const flag = isLast ? true : false;
          /** babel 新版本规定,模版ast第一个参数必须比第二个多一个 */
          if (!t.isStringLiteral(node)) {
            templateExpressions.push(node);
            pushTemplateElement('', flag);
          } else {
            /** 是字符串,则需要进行一些额外的操作,比如把前面的串起来 */
            const aheadEle = templateElements.pop();
            if (aheadEle) {
              const aheadRaw = aheadEle.value.raw;
              pushTemplateElement(aheadRaw + node.value, flag);
            } else {
              pushTemplateElement(node.value, flag);
            }
          }
        });
        if (!t.isStringLiteral(binaryNodes[0])) {
          templateElements.unshift(createTempElement('', false));
        }
        const templateLiteral = t.templateLiteral(templateElements, templateExpressions);
        path.replaceWith(templateLiteral);
        makeFlagToShowChangedAst(state);
      },
      /** stringLiteral就是类似'123'这种，JSXText就是类似<p>hello</p>这种 */
      StringLiteral(path, state) {
        const value = getStrPathValue(path);
        resolveAst(path, state, value, JSON.stringify(value));
      },
      JSXText(path, state) {
        const value = getStrPathValue(path).toString().replace(/\n/g, '').trim();
        resolveAst(path, state, value, JSON.stringify(value));
      },
      /** TemplateLiteral就是类似`123`这种 */
      TemplateLiteral(path, state) {
        /** 获得的value其实是删除差值后的字符串,比如`123${name}321`得到的value就为`123{arg0}321` */
        const value = getTemStrPathValue(path);
        /**模版字符串需要得到最初的形式,用于后面的default */
        const sourceCode = generate(path.node).code;
        resolveAst(path, state, value, sourceCode);
      },
    },
    //babel执行到末尾的钩子
    post(file) {
      const allTextList = fileAction.get(file, AllText);
      const intlData = allTextList.reduce((obj, item) => {
        obj[item.key] = item.value;
        return obj;
      }, {});
      options.mappingCallbacks(intlData);
      fileAction.get(file, shouldFinalAction) && fileAction.get(file, finalAction)();
    },
  };
});
module.exports = { autoI18nPlugin, defaultOptions };
