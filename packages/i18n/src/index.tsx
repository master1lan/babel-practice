import { Button } from './components/button';
/** 注意看,这里没有导入getLangMsg,但是文件内有需要替换的中文,会自动进行导入 */

/** 这里也是错误的写法,不应该在类型中写中文,这里进行了额外处理,类型申明中的中文不会被转换 */
interface Props {
  title: '哈哈' | '怎么就写中文呢';
}
const enum Title {
  'chinese' = '你好',
  'english' = 'hello',
}

const getName = (preName: '小明' | '小红') => preName + '同学';
export default function App() {
  /** 这里的会依次转换 */
  const msgArr = ['消息提示', '这里的中文因为没有使用加号', '所以不会被进行拼接'];
  const obj = {
    '123': '你好',
    '中文：': '你好',
    '英文：': 'hello' + getName('小红'),
    english: `${'hello'},你好`,
  };

  return (
    <div title={'标题'}>
      <Button />
      {/* 这里的为jsx内直接填写的 */}
      <div>你好</div>
    </div>
  );
}
