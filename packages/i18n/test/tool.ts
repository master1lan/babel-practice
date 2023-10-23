import { parse } from '@babel/parser';
import { transformFromAstSync } from '@babel/core';
import { autoI18nPlugin, defaultOptions } from '../plugin/i18n';

export function transformAst(sourceCode: string, options = defaultOptions) {
  const ast = parse(sourceCode, {
    errorRecovery: true,
    sourceFilename: 'mock.tsx',
    sourceType: 'unambiguous',
    plugins: ['jsx', 'typescript'],
  });
  const { code } = transformFromAstSync(ast, sourceCode, {
    filename: 'mock.tsx',
    configFile: false,
    plugins: [[autoI18nPlugin, options]],
  });
  return code;
}
