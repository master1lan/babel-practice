import { Button } from './components/button';
/** 注意看,这里没有导入getLangMsg,但是文件内有需要替换的中文,会自动进行导入 */

/** 这里也是错误的写法,不应该在类型中写中文,这里进行了额外处理,类型申明中的中文不会被转换 */
interface Props {
  title: '哈哈' | '怎么就写中文呢';
}
const a = '你',
  b = a,
  c = b,
  d = c,
  e = d;
'好' + a;
'好' + a + '是';
'好' + a + b;
'好' + a + b + '是';
'好' + a + b + '是' + c;
'好' + '好' + a + b + '是' + '是' + c + '可';
a + '是';
a + b + c + '是';
a + '是' + b;
a + '是' + b + '可';
a + '是' + '是' + b;
a + '是' + '是' + b + c;
a + '是' + '是' + b + c + '可';
const getName = (preName: '小明' | '小红') => preName + '同学';
export default function App() {
  /** 这里的会依次转换 */
  const msgArr = ['消息提示', '这里的中文因为没有使用加号', '所以不会被进行拼接'];
  const obj = {
    '123': '你好',
    '中文：': '你好',
    '英文：': 'hello' +getName('小红'),
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
