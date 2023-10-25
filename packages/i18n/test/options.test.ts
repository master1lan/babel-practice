import { describe, expect, test, jest } from '@jest/globals';
import { transformAst } from './tool';

const mockCode = `
   const a='123'
`;
const pluginDefaultOptions = {
  mappingCallbacks: (dict) => {},
  changeAstCallback: () => {},
  injectIntlImport: 'import {getLangMsg} from "."',
  getIntlFunc: (hash, sourceMsg) => `getLangMsg(${hash}).d(${sourceMsg})`,
};

describe('test options format check', () => {
  test('resolve options', () => {
    expect(() => transformAst(mockCode, pluginDefaultOptions)).not.toThrowError();
  });
  test('options format not valid', () => {
    const newOptions = {
      mappingCallbacks: (dict) => {},
      changeAstCallback: () => {},
      intlFuncName: 'getLangMsg',
    } as any;
    expect(() => transformAst(mockCode, newOptions)).toThrowError();
  });
});

describe('test options callback', () => {
  test('mappingCallbacks', () => {
    const fn = jest.fn();
    const newOptions = pluginDefaultOptions;
    newOptions.mappingCallbacks = fn;
    transformAst(mockCode, newOptions);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  test('changeAstCallback', () => {
    const fn = jest.fn();
    const newOptions = pluginDefaultOptions;
    newOptions.changeAstCallback = fn;
    transformAst(`const a="中文"`, newOptions);
    expect(fn).toHaveBeenCalled();
  });
});
