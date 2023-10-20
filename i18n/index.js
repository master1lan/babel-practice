const { transformFromAstSync } = require('@babel/core');
const parser = require('@babel/parser');
const prettier = require('prettier');
const autoI18nPlugin = require('./plugin/i18n');
const fs = require('fs');
const path = require('path');

const prettierConfPath = path.resolve(__dirname, '../', '.prettierrc');
const srcPath = path.resolve(__dirname, './src');

/**
 * 对单个文件进行ast分析，返回整理后的code
 */
function transformSingleFile(
  filePath,
  options = {
    /** 在babel解析结束之前，获取解析字典的callback */
    mappingCallbacks: (dict) => {},
    /** babel解析后如果修改了源代码，则需要通过callback进行调用通知外部 */
    changeAstCallback: () => {},
    /** 国际化函数名，比如提供intl，则会将 '你好'转译成intl('md5Hash:15') */
    intlFuncName: '',
    /** 导入国际化函数的import语句，将会在需要导入的文件最上面自动添加，比如： import {intl} from "@/utils/intl" */
    injectIntlImport: '',
  },
) {
  const sourceCode = fs.readFileSync(filePath, {
    encoding: 'utf-8',
  });
  const ast = parser.parse(sourceCode, {
    errorRecovery: true,
    sourceFilename: filePath,
    sourceType: 'unambiguous',
    plugins: ['jsx', 'typescript'],
  });
  const { code } = transformFromAstSync(ast, sourceCode, {
    filename: filePath,
    configFile: false,
    plugins: [[autoI18nPlugin, options]],
  });
  return code;
}

// 递归读取文件(夹),是文件则调用callback
function fsRead(curPath = __dirname, callback = (filePath) => {}) {
  if (!fs.existsSync(curPath)) {
    throw Error('找不到文件夹路径' + curPath);
  }
  if (fs.statSync(curPath).isFile()) {
    callback(curPath);
  } else if (fs.statSync(curPath).isDirectory()) {
    fs.readdirSync(curPath).map((fileName) => fsRead(path.join(curPath, fileName), callback));
  }
}

const prettierConf = JSON.parse(fs.readFileSync(prettierConfPath, { encoding: 'utf-8' }));
const intlDict = {};
const mappingDict = (dict = {}) => Object.assign(intlDict, dict);
const ignoreFile = ['intl/index.ts'];
const parseFileType = ['.js', '.ts', '.tsx', '.jsx'];

fsRead(srcPath, (filePath) => {
  const judgeParse =
    parseFileType.some((fileType) => filePath.endsWith(fileType)) &&
    !ignoreFile.some((fileType) => filePath.endsWith(fileType));
  if (judgeParse) {
    /** 判断是否需要修改 */
    let shouldWriteFile = false;
    const transformChangedAst = () => (shouldWriteFile = true);
    /** 执行编译 */
    const code = transformSingleFile(filePath, {
      mappingCallbacks: mappingDict,
      changeAstCallback: transformChangedAst,
      intlFuncName: 'getLangMsg',
      injectIntlImport: 'import { getLangMsg } from "@/intl";',
    });
    /** 如果不需要覆盖文件直接返回 */
    if (!shouldWriteFile) {
      return;
    }
    /** 由于babel本身不会格式化文件，需要借助prettier进行格式化再保存 */
    prettier
      .format(code, { ...prettierConf, filepath: filePath })
      .then((formatCode) => fs.writeFileSync(filePath, formatCode, { encoding: 'utf-8' }));
  }
});

const jsonPath = path.join(path.resolve(__dirname, 'output'), 'zh_CN.json');
if (fs.existsSync(jsonPath)) {
  const oldDict = JSON.parse(fs.readFileSync(jsonPath, { encoding: 'utf-8' }));
  mappingDict(oldDict);
}
/** 保存json文件 */
fs.writeFileSync(jsonPath, JSON.stringify(intlDict), {
  encoding: 'utf-8',
});
