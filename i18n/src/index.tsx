import { Button } from './components/button';
/** 注意看,这里没有导入getLangMsg,但是文件内有需要替换的中文,会自动进行导入 */

/** 这里也是错误的写法,不应该在类型中写中文,这里进行了额外处理,类型申明中的中文不会被转换 */
interface Props {
  title: '哈哈' | '怎么就写中文呢';
}

export default function App() {
  const msgArr = ['消息提示', '这里的中文因为没有使用加号', '所以不会被进行拼接'];
  const obj = {
    这是错误的写法: '其实不应该在对象的键里面写中文',
  };
  return (
    <div title='测试'>
      <Button />
    </div>
  );
}
