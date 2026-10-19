import json
import shutil
from dataclasses import asdict
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from PIL import Image
from nycs_studio.control_library import ControlLibrary
from nycs_studio.models import Project, Selector, Step, load_project, save_project
from nycs_studio.service import Service
from nycs_studio import service as native


class SharedControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.library = ControlLibrary(self.root)

    def coordinate(self, name='商城', x=.4):
        return self.library.save(asdict(Selector(name, x=x)))['control']

    def case(self, control, name='用例'):
        selector = Selector(**control['selector'])
        return Project(name, [selector], [Step(target=selector.name)])

    def save_case(self, project, name='case'):
        path = self.root/'test_cases'/f'{name}.nycs.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        return path, save_project(self.library.resolve_project(project, path.parent), path, path.parent)

    def test_two_cases_use_updated_definition_and_rename_by_stable_id(self):
        control = self.coordinate()
        first, second = self.case(control, '甲'), self.case(control, '乙')
        updated = {**control['selector'], 'name':'商城入口', 'x':.8}
        self.library.save(updated, identifier=control['id'])
        reloaded = ControlLibrary(self.root)
        for project in (first, second):
            resolved = reloaded.resolve_project(project, self.root)
            self.assertEqual(resolved.steps[0].target, '商城入口')
            self.assertEqual(resolved.selectors[0].x, .8)
            self.assertEqual(resolved.selectors[0].library_id, control['id'])

    def test_migration_deduplicates_equal_controls_and_keeps_name_conflicts(self):
        first = Project('旧甲', [Selector('按钮', x=.2)], [Step(target='按钮')])
        second = Project('旧乙', [Selector('按钮', x=.2)], [Step(target='按钮')])
        third = Project('旧丙', [Selector('按钮', x=.9)], [Step(target='按钮')])
        paths=[]
        for index, project in enumerate((first, second, third)):
            path=self.root/'projects'/str(index)/'old.nycs.json';path.parent.mkdir(parents=True)
            save_project(project,path,path.parent);paths.append(path)
        original_bytes=[path.read_bytes() for path in paths]
        self.library.migrate()
        self.assertEqual(len(self.library.list()['entries']),2)
        imported=[self.library.import_project(load_project(path),path.parent,path) for path in paths]
        self.assertEqual(imported[0].selectors[0].library_id,imported[1].selectors[0].library_id)
        self.assertNotEqual(imported[0].selectors[0].library_id,imported[2].selectors[0].library_id)
        self.assertEqual(imported[2].steps[0].target,imported[2].selectors[0].name)
        before=self.library.path.read_bytes();self.library.migrate();self.assertEqual(before,self.library.path.read_bytes())
        self.assertEqual(original_bytes,[path.read_bytes() for path in paths])

    def test_moving_workspace_preserves_legacy_references_to_edited_shared_controls(self):
        path=self.root/'projects'/'legacy.nycs.json';path.parent.mkdir()
        save_project(Project('旧用例',[Selector('按钮',x=.2)],[Step(target='按钮')]),path,path.parent)
        self.library.migrate();control=self.library.list()['entries'][0]
        self.library.save({**control['selector'],'name':'新按钮','x':.9},identifier=control['id'])
        legacy=json.loads(self.library.path.read_text(encoding='utf-8'))
        legacy['imports']={str(self.root/key):value for key,value in legacy['imports'].items()}
        self.library.path.write_text(json.dumps(legacy),encoding='utf-8')
        self.library=ControlLibrary(self.root)
        self.assertTrue(all(not Path(key).is_absolute() for key in json.loads(self.library.path.read_text())['imports']))
        with tempfile.TemporaryDirectory() as directory:
            moved=Path(directory)/'workspace';shutil.copytree(self.root,moved)
            other=ControlLibrary(moved);other.migrate()
            relocated=moved/'projects'/'legacy.nycs.json'
            project=other.import_project(load_project(relocated),relocated.parent,relocated)
            self.assertEqual(other.list()['total'],1)
            self.assertEqual(project.selectors[0].library_id,control['id'])
            self.assertEqual(project.selectors[0].x,.9)
            self.assertEqual(project.steps[0].target,'新按钮')

    def test_categories_search_and_category_deletion_preserve_controls(self):
        category=self.library.save_category('任务面板')['category']
        control=self.coordinate('完成任务')
        self.library.save(control['selector'], category['id'], control['id'])
        self.assertEqual(len(self.library.list('任务面板 完成')['entries']),1)
        self.assertEqual(self.library.list('不存在')['entries'],[])
        self.assertEqual(len(self.library.list(category_id=category['id'])['entries']),1)
        self.library.save_category('主线任务',category['id'])
        self.assertEqual(len(self.library.list('主线')['entries']),1)
        with self.assertRaisesRegex(ValueError,'已存在'):self.library.save_category('主线任务')
        self.library.delete_category(category['id'])
        self.assertEqual(self.library.list()['uncategorized'],1)
        self.assertEqual(self.library.list()['entries'][0]['id'],control['id'])

    def test_images_variants_masks_and_anchors_are_copied_to_shared_assets(self):
        source=self.root/'legacy';source.mkdir()
        for name,color in [('title.png','red'),('button.png','blue'),('variant.png','green'),('mask.png','white')]:
            Image.new('RGB',(12,10),color).save(source/name)
        project=Project('图片',[
            Selector('标题',kind='image',image='title.png'),
            Selector('按钮',kind='image',image='button.png',anchor='标题',roi=[0,0,100,100],
                     templates=[{'image':'variant.png','mask':'mask.png'}],mask='mask.png')],
            [Step(target='按钮')])
        imported=self.library.import_project(project,source)
        self.assertEqual(len(self.library.list()['entries']),2)
        for target in imported.selectors:
            for asset in target.asset_paths():self.assertTrue(self.library.asset_path(asset).is_file())
        for path in source.glob('*.png'):path.unlink()
        resolved=self.library.resolve_project(imported,source)
        for target in resolved.selectors:
            for asset in target.asset_paths():self.assertTrue(Path(asset).is_absolute())
        path,saved=self.save_case(imported,'images')
        for target in saved.selectors:
            for asset in target.asset_paths():self.assertTrue((path.parent/asset).is_file())
        moved=self.root/'moved';other=ControlLibrary(moved)
        portable=other.import_project(load_project(path),path.parent,path)
        self.assertEqual({s.library_id for s in portable.selectors},{s.library_id for s in imported.selectors})

    def test_rename_updates_global_anchor_and_includes_new_anchor_in_old_cases(self):
        first=self.library.save(asdict(Selector('标题',kind='image',recognition='ocr',text='标题')))['control']
        button=self.library.save(asdict(Selector('按钮',kind='image',recognition='ocr',text='按钮')))['control']
        project=self.case(button)
        self.library.save({**button['selector'],'anchor':'标题','roi':[0,0,100,100]},identifier=button['id'])
        self.library.save({**first['selector'],'name':'新标题'},identifier=first['id'])
        resolved=self.library.resolve_project(project,self.root)
        self.assertEqual({s.name for s in resolved.selectors},{'按钮','新标题'})
        self.assertEqual(resolved.selectors[0].anchor,'新标题')
        with self.assertRaisesRegex(ValueError,'锚点'):self.library.delete(first['id'])
        before=self.library.path.read_bytes()
        with self.assertRaisesRegex(ValueError,'循环'):
            self.library.save({**first['selector'],'name':'新标题','anchor':'按钮','roi':[0,0,100,100]},identifier=first['id'])
        self.assertEqual(before,self.library.path.read_bytes())

    def test_deletion_blocks_saved_and_unsaved_references(self):
        control=self.coordinate();project=self.case(control)
        with self.assertRaisesRegex(ValueError,'当前用例'):self.library.delete(control['id'],[control['id']])
        path,_=self.save_case(project)
        with self.assertRaisesRegex(ValueError,'已保存用例'):self.library.delete(control['id'])
        unused=Project('空用例',[Selector(**control['selector'])],[])
        save_project(unused,path,path.parent)
        self.library.delete(control['id'])
        restored=self.library.import_project(load_project(path),path.parent,path)
        self.assertEqual(restored.selectors,[])
        with self.assertRaisesRegex(ValueError,'不存在'):self.library.resolve_project(project,path.parent)

    def test_legacy_deletion_protection_follows_original_case_names(self):
        original=Project('旧用例',[Selector('原按钮')],[Step(target='原按钮')])
        path=self.root/'test_cases'/'old.nycs.json';path.parent.mkdir()
        save_project(original,path,path.parent)
        self.library.migrate();control=self.library.list()['entries'][0]
        self.library.save({**control['selector'],'name':'新按钮'},identifier=control['id'])
        with self.assertRaisesRegex(ValueError,'旧用例'):self.library.delete(control['id'])
        imported=self.library.import_project(load_project(path),path.parent,path)
        self.assertEqual(imported.steps[0].target,'新按钮')

    def test_python_uses_all_shared_controls_and_keeps_renamed_script_aliases(self):
        control=self.coordinate('旧名字');extra=self.coordinate('新增控件')
        project=Project('脚本',[Selector(**control['selector'])],[Step(action='python',params={'code':'game.click("旧名字")'})])
        self.library.save({**control['selector'],'name':'新名字'},identifier=control['id'])
        imported=self.library.import_project(project,self.root)
        resolved=self.library.resolve_project(imported,self.root)
        self.assertEqual({s.name for s in resolved.selectors},{'旧名字','新名字','新增控件'})
        self.assertEqual(resolved.steps[0].params['code'],'game.click("旧名字")')

    def test_pruning_keeps_only_step_references_and_anchor_dependencies(self):
        one=self.coordinate('使用');two=self.coordinate('未使用')
        project=Project('简洁',[Selector(**one['selector']),Selector(**two['selector'])],[Step(target='使用')])
        trimmed=self.library.prune_project(project)
        self.assertEqual([s.name for s in trimmed.selectors],['使用'])
        self.assertEqual(len(self.library.list()['entries']),2)

    def test_invalid_reference_and_template_paths_are_rejected_without_registry_write(self):
        with self.assertRaisesRegex(ValueError,'标识'):Selector('控件',library_id='../bad').validate()
        with self.assertRaisesRegex(ValueError,'assets'):
            self.library.save(asdict(Selector('图片',kind='image',image='../private.png')))
        self.assertFalse(self.library.path.exists())


class SharedControlServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.enterContext(patch.object(native,'ROOT',self.root))
        self.enterContext(patch.dict(native.os.environ,{},clear=True))
        self.service=Service.__new__(Service)
        self.service.running=False;self.service.recorder=None;self.service.base_dir=self.root/'test_cases'
        self.service.stop_event=threading.Event();self.service.emit=Mock();self.service.window=Mock(return_value=Mock(pid=5))

    def test_controls_survive_new_case_load_save_and_service_restart(self):
        control=self.service.call('control_save',{'selector':asdict(Selector('共享'))})['control']
        project=Project('甲',[Selector(**control['selector'])],[Step(target='共享')])
        path=self.root/'test_cases'/'first.nycs.json'
        self.service.call('save_project',{'path':str(path),'project':project.to_dict()})
        self.service.call('new_project',{})
        self.assertEqual(self.service.call('control_list',{})['entries'][0]['id'],control['id'])
        self.service.call('control_save',{'id':control['id'],'selector':{**control['selector'],'name':'更新','x':.9}})
        loaded=self.service.call('load_project',{'path':str(path)})['project']
        self.assertEqual(loaded['steps'][0]['target'],'更新')
        self.assertEqual(loaded['selectors'][0]['x'],.9)
        self.assertEqual(ControlLibrary(self.root).list()['entries'][0]['selector']['name'],'更新')

    def test_run_resolves_latest_configuration_before_worker_creation(self):
        control=self.service.call('control_save',{'selector':asdict(Selector('按钮',x=.2))})['control']
        project=Project('执行',[Selector(**control['selector'])],[Step(target='按钮')])
        self.service.call('control_save',{'id':control['id'],'selector':{**control['selector'],'x':.8}})
        with patch.object(native,'WindowsBackend'),patch.object(native,'Runner') as runner:
            self.service.call('run',{'project':project.to_dict(),'handle':1})
            self.service.worker.join(1)
            self.assertEqual(runner.call_args.args[1].selectors[0].x,.8)

    def test_mutations_are_blocked_while_running_but_search_is_available(self):
        self.service.call('control_save',{'selector':asdict(Selector('按钮'))})
        self.service.running=True
        self.assertEqual(len(self.service.call('control_list',{'query':'按钮'})['entries']),1)
        with self.assertRaisesRegex(ValueError,'停止'):
            self.service.call('control_category_save',{'name':'任务'})


if __name__=='__main__':unittest.main()