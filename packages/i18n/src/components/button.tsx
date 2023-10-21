/** 注意看,这里已经导入了这个,后面转换的时候不会再进行额外的导入 */
import { getLangMsg } from '@/intl';

export function Button() {
  return (
    <button
      title='你好'
      onClick={(e) => {
        if (e.target.value === '这里也写一个中文') {
          const value = '变量中文';
          /** 这里会先转换成模版字符串,然后再进行解析 */
          return '中文' + value + '中文';
        }
      }}
    >
      你好
    </button>
  );
}
