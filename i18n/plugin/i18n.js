const { declare } = require('@babel/helper-plugin-utils');
const generate = require('@babel/generator').default;
const parser = require('@babel/parser');
const t = require('@babel/types');
const crypto = require('crypto-js');

const AllText = 'allText';
const finalAction = 'finalAction';
const shouldFinalAction = 'noImport';

const defaultOptions = {
  mappingCallbacks: (dict) => {},
  /** babel解析后如果修改了源代码，则需要通过callback进行调用通知外部 */
  changeAstCallback: () => {},
  /** 国际化函数名，比如提供intl，则会将 '你好'转译成intl('md5Hash:15') */
  intlFuncName: '',
  /** 导入国际化函数的import语句，将会在需要导入的文件最上面自动添加，比如： import {intl} from "@/utils/intl" */
  injectIntlImport: '',
};
const formatOptionsKeys = Object.keys(defaultOptions);

const autoTrackPlugin = declare((api, options, dirname) => {
  api.assertVersion(7);
  if (formatOptionsKeys.some((propKey) => !Reflect.has(options, propKey))) {
    throw new Error(
      `options format error,please make sure options object includes ${formatOptionsKeys}!`,
    );
  }
  const includesChinese = (v) => /[\u4e00-\u9fa5]/g.test(v);
  const intlName = options.intlFuncName,
    intlImportString = options.injectIntlImport;
  const intlImportAst = parser.parse(intlImportString, {
    sourceType: 'unambiguous',
  }).program.body[0];
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
  /** 将目标ast转换成新的ast  */
  function getReplaceExpression(path, value, intlUid) {
    // 首先提取出来变量->['name','title',...]
    const expressionParams = path.isTemplateLiteral()
      ? path.node.expressions.map((item) => generate(item).code)
      : [];
    // 转换成类似{arg0:name,arg1:title}的ast
    const expressionToAst = t.objectExpression(
      expressionParams.map((expression, index) =>
        t.objectProperty(t.identifier(`arg${index}`), t.identifier(expression)),
      ),
    );
    // 替换后的ast
    let replaceExpression = api.template.ast(
      `${intlUid}('${value}',${expressionParams.length ? generate(expressionToAst).code : ''})`,
    ).expression;
    // 若包含在jsx中间，需要包裹一层{}
    if (path.findParent((p) => p.isJSXAttribute())) {
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
        replaceExpression = api.types.JSXExpressionContainer(replaceExpression);
      }
    } else if (path.isJSXText()) {
      replaceExpression = api.types.JSXExpressionContainer(replaceExpression);
    }

    return replaceExpression;
  }
  /** babel没有好的方法和外面交互，使用callback的方式通知外面这份文件需要变更 */
  function makeFlagToShowChangedAst(state) {
    state.file.set(shouldFinalAction, true);
    options.changeAstCallback();
  }
  /** 将识别并转换好的中文字段保存到babel提供的store中，返回对应的key  */
  function saveText(file, value) {
    const allText = file.get(AllText);
    const modifyValue = value.toString().replace(/\n/g, '').trim();
    const md5 = crypto.MD5(value).toString().slice(0, 10);
    allText.push({
      key: md5,
      value: modifyValue,
    });
    file.set(AllText, allText);
    return md5;
  }
  /** 有些ast节点可能被标记需要跳过 */
  function checkSkip(path) {
    return path.node.skipTransform;
  }
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
  /** 集中处理ast */
  function resolveAst(path, state, value) {
    if (path.findParent((p) => p.isTSLiteralType() || p.isObjectProperty())) {
      return;
    }
    if (checkSkip(path) || !value || !includesChinese(value)) {
      return;
    }
    let key = saveText(state.file, value);

    const replaceExpression = getReplaceExpression(path, key, state.intlUid);
    path.replaceWith(replaceExpression);
    makeFlagToShowChangedAst(state);
  }

  return {
    /** 处理之前的准备操作 */
    pre(file) {
      file.set(AllText, []);
      file.set(finalAction, () => {});
      file.set(shouldFinalAction, false);
    },
    visitor: {
      Program: {
        /** 无论什么ast type都会执行这段 */
        enter(path, state) {
          let imported = false;
          // 每一个traverse都可以看作一次单独的解析ast
          // 这段用于查询该文件内是否已导入相关api，未导入则自动在第一行导入。
          path.traverse({
            ImportDeclaration(p) {
              if (p.node.source.value !== intlImportAst.source.value) {
                return;
              }
              if (p.node.specifiers.some((node) => node.imported.name === intlName)) {
                imported = true;
              }
            },
          });
          state.intlUid = intlName;
          if (!imported) {
            const importAst = api.template.ast(intlImportString);
            state.file.set(finalAction, () => {
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
      /** 处理操作符情况，只处理+；当有一边是字符串时，js执行字符串拼接 */
      BinaryExpression(path, state) {
        /**
         * 这里需要额外处理一种情况：'a'+b+c+d
         * 由于操作符是RHS,d会被认为是right，其余的是left，并且整个表达式只会走一遍这个处理
         * 需要判断：当整个加法链存在string（执行函数返回的string类型不算，必须是babel认定的string类型）
         * 时，执行字符串加法转换成模版字符串。
         *  */
        if (path.node.operator !== '+' || !isChainStringExpression(path.node)) {
          return;
        }
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
        /** 由于类似a+b+c+d会被babel解析成二叉树，所以需要后续遍历才能形成[a,b,c,d]的数组 */
        const binaryNodes = reducerBinary(path.node);
        const templateElements = [],
          templateExpressions = [];
        let lastVariable = false;
        binaryNodes.map((node, index) => {
          const isFirst = index === 0;
          const isLast = index === binaryNodes.length;
          const flag = isLast ? true : false;
          /** babel 新版本规定,模版ast第一个参数必须比第二个多一个 */
          /** 如果不是字符串,则说明是变量,此时只需要保存 */
          if (!t.isStringLiteral(node)) {
            templateExpressions.push(node);
            // templateElements.push(t.templateElement({ raw: '', cooked: '' }, flag));
            lastVariable = true;
          } else {
            /** 是字符串,则需要进行一些额外的操作,比如把前面的串起来 */
            const res = { raw: node.value, cooked: node.value };
            if (!isFirst) {
              const aheadEle = templateElements.pop();
              const aheadRaw = aheadEle.value.raw;

              if (lastVariable) {
                templateElements.push(aheadEle);
              } else {
                res.raw = aheadRaw;
                res.cooked = aheadRaw;
              }
            }
            templateElements.push(t.templateElement({ raw: node.value, cooked: node.value }, flag));
            lastVariable = false;
          }
        });

        const templateLiteral = t.templateLiteral(templateElements, templateExpressions);
        path.replaceWith(templateLiteral);
        makeFlagToShowChangedAst(state);
      },
      /** 解析到如 ''的token则执行该回调 */
      StringLiteral(path, state) {
        resolveAst(path, state, path.node.value);
      },
      TemplateLiteral(path, state) {
        const value = path
          .get('quasis')
          .map((item) => item.node.value.raw)
          .reduce(
            (preStr, curStr, curIndex) =>
              // 因为是上一个，所以需要减1
              `${preStr}{arg${curIndex - 1}}${curStr}`,
          );
        resolveAst(path, state, value);
      },
      /** 单独处理jsx内包裹的中文 */
      JSXText(path, state) {
        resolveAst(path, state, path.node.value);
      },
    },
    post(file) {
      const allText = file.get(AllText);
      const intlData = allText.reduce((obj, item) => {
        obj[item.key] = item.value;
        return obj;
      }, {});
      options.mappingCallbacks(intlData);
      file.get(shouldFinalAction) && file.get(finalAction)();
    },
  };
});
module.exports = autoTrackPlugin;
