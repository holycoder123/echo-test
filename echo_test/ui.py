from __future__ import annotations
import copy
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from uuid import uuid4
from PIL import Image, ImageTk, ImageDraw
from .backend import list_game_windows, WindowsBackend, is_admin
from .engine import Runner
from .models import Project, Selector, Step, ACTIONS, PARAMETERS, TARGET_ACTIONS, load_project, save_project
from .vision import Vision, coordinate

ROOT = Path(__file__).resolve().parents[1]
LABEL_TO_ACTION = {value: key for key, value in ACTIONS.items()}


def entry_row(parent, row, label, variable, width=25):
    ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=(0, 10), pady=6)
    widget = ttk.Entry(parent, textvariable=variable, width=width)
    widget.grid(row=row, column=1, sticky="ew", pady=6)
    return widget


class CapturePicker(tk.Toplevel):
    def __init__(self, parent, image, mode):
        super().__init__(parent)
        self.title("截图选取 · " + ("点击目标位置" if mode == "coordinate" else "拖动框选控件模板"))
        self.image = image
        self.mode = mode
        self.result = None
        self.accepted = False
        self.start = None
        self.scale = min(1, 1040 / image.width, 620 / image.height)
        self.view = ImageTk.PhotoImage(image.resize((round(image.width * self.scale), round(image.height * self.scale))))
        ttk.Label(self, text="点击位置，或拖动框选。蓝框为选取区域；确认后保存。", padding=12).pack(anchor="w")
        self.canvas = tk.Canvas(self, width=self.view.width(), height=self.view.height(), bg="#111827", highlightthickness=0, cursor="crosshair")
        self.canvas.pack(padx=12)
        self.canvas.create_image(0, 0, anchor="nw", image=self.view)
        self.canvas.bind("<ButtonPress-1>", self.press)
        self.canvas.bind("<B1-Motion>", self.motion)
        self.canvas.bind("<ButtonRelease-1>", self.release)
        footer = ttk.Frame(self, padding=12)
        footer.pack(fill="x")
        self.hint = tk.StringVar(value="尚未选取")
        ttk.Label(footer, textvariable=self.hint).pack(side="left")
        ttk.Button(footer, text="取消", command=self.cancel).pack(side="right", padx=6)
        ttk.Button(footer, text="确认选取", command=self.confirm).pack(side="right")
        self.transient(parent)
        self.grab_set()
        self.bind("<Escape>", lambda _: self.cancel())
        self.protocol("WM_DELETE_WINDOW", self.cancel)

    def point(self, event):
        return max(0, min(self.image.width - 1, round(event.x / self.scale))), max(0, min(self.image.height - 1, round(event.y / self.scale)))

    def press(self, event):
        self.start = self.point(event)
        self.canvas.delete("selection")
        if self.mode == "coordinate":
            self.result = self.start
            self.canvas.create_oval(event.x - 6, event.y - 6, event.x + 6, event.y + 6, outline="#18baf0", width=3, tags="selection")
            self.hint.set(f"客户区坐标：{self.start}")

    def motion(self, event):
        if self.mode == "image" and self.start:
            self.canvas.delete("selection")
            self.canvas.create_rectangle(self.start[0] * self.scale, self.start[1] * self.scale, event.x, event.y, outline="#18baf0", width=2, tags="selection")

    def release(self, event):
        if self.mode == "image" and self.start:
            end = self.point(event)
            x1, x2 = sorted([self.start[0], end[0]])
            y1, y2 = sorted([self.start[1], end[1]])
            self.result = (x1, y1, x2, y2) if x2 - x1 >= 4 and y2 - y1 >= 4 else None
            self.hint.set(f"模板区域：({x1}, {y1})，{x2-x1} × {y2-y1}")

    def confirm(self):
        if self.result is None:
            messagebox.showinfo("选取区域", "请先选取有效位置 / 至少 4×4 像素的模板区域", parent=self)
            return
        self.accepted = True
        self.destroy()

    def cancel(self):
        self.result = None
        self.destroy()


class SelectorDialog(tk.Toplevel):
    def __init__(self, app, selector=None):
        super().__init__(app)
        self.app = app
        self.title("编辑控件" if selector else "新增控件")
        self.resizable(False, False)
        self.result = None
        self.original = selector.name if selector else None
        seed = selector or Selector(name="新控件")
        self.seed = copy.deepcopy(seed)
        self.name = tk.StringVar(value=seed.name)
        self.kind = tk.StringVar(value="坐标" if seed.kind == "coordinate" else "截图识别")
        self.x, self.y = tk.StringVar(value=str(seed.x)), tk.StringVar(value=str(seed.y))
        self.normalized = tk.BooleanVar(value=seed.normalized)
        self.path = tk.StringVar(value=seed.image)
        self.threshold = tk.StringVar(value=str(seed.threshold))
        self.scales = tk.StringVar(value=", ".join(str(v) for v in seed.scales))
        self.roi = tk.StringVar(value=", ".join(str(v) for v in seed.roi) if seed.roi else "")
        self.offset_x, self.offset_y = tk.StringVar(value=str(seed.offset_x)), tk.StringVar(value=str(seed.offset_y))
        frame = ttk.Frame(self, padding=22)
        frame.pack(fill="both", expand=True)
        frame.columnconfigure(1, weight=1)
        entry_row(frame, 0, "控件名称", self.name, 43)
        ttk.Label(frame, text="定位方式").grid(row=1, column=0, sticky="w")
        mode = ttk.Combobox(frame, textvariable=self.kind, values=["坐标", "截图识别"], state="readonly")
        mode.grid(row=1, column=1, sticky="ew", pady=6)
        self.coordinate_frame = ttk.LabelFrame(frame, text="客户区坐标", padding=12)
        self.coordinate_frame.grid(row=2, column=0, columnspan=2, sticky="ew", pady=10)
        self.coordinate_frame.columnconfigure(1, weight=1)
        entry_row(self.coordinate_frame, 0, "X", self.x)
        entry_row(self.coordinate_frame, 1, "Y", self.y)
        ttk.Checkbutton(self.coordinate_frame, text="比例坐标（0 ~ 1，适应窗口尺寸）", variable=self.normalized).grid(row=2, column=0, columnspan=2, sticky="w", pady=8)
        self.image_frame = ttk.LabelFrame(frame, text="截图模板识别", padding=12)
        self.image_frame.grid(row=3, column=0, columnspan=2, sticky="ew", pady=10)
        self.image_frame.columnconfigure(1, weight=1)
        entry_row(self.image_frame, 0, "模板文件", self.path)
        entry_row(self.image_frame, 1, "匹配阈值（0.5 ~ 1）", self.threshold)
        entry_row(self.image_frame, 2, "缩放倍率（逗号分隔）", self.scales)
        entry_row(self.image_frame, 3, "搜索区域 x,y,宽,高", self.roi)
        ttk.Button(self.image_frame, text="导入模板图片", command=self.import_image).grid(row=4, column=1, sticky="e", pady=5)
        ttk.Label(self.image_frame, text="空搜索区域表示整个客户区；模板应含文字或边缘。", style="Muted.TLabel").grid(row=5, column=0, columnspan=2, sticky="w", pady=4)
        entry_row(frame, 4, "点击偏移 X（像素）", self.offset_x)
        entry_row(frame, 5, "点击偏移 Y（像素）", self.offset_y)
        footer = ttk.Frame(frame)
        footer.grid(row=6, column=0, columnspan=2, sticky="ew", pady=(15, 0))
        ttk.Button(footer, text="从目标应用截图选取", command=self.pick).pack(side="left")
        ttk.Button(footer, text="保存控件", command=self.save, style="Accent.TButton").pack(side="right")
        ttk.Button(footer, text="取消", command=self.destroy).pack(side="right", padx=6)
        mode.bind("<<ComboboxSelected>>", lambda _: self.update_mode())
        self.update_mode()
        self.transient(app)
        self.grab_set()

    def update_mode(self):
        if self.kind.get() == "坐标":
            self.image_frame.grid_remove()
            self.coordinate_frame.grid()
        else:
            self.coordinate_frame.grid_remove()
            self.image_frame.grid()

    def import_image(self):
        path = filedialog.askopenfilename(parent=self, filetypes=[("图片", "*.png *.jpg *.jpeg *.bmp"), ("所有文件", "*.*")])
        if path:
            try:
                with Image.open(path) as image:
                    image.verify()
                self.path.set(self.app.store_image(Path(path)))
            except Exception as error:
                messagebox.showerror("模板导入失败", str(error), parent=self)

    def pick(self):
        try:
            screen = self.app.game_capture()
            self.lift()
            self.focus_force()
            picker = CapturePicker(self, screen, "coordinate" if self.kind.get() == "坐标" else "image")
            self.wait_window(picker)
            if picker.result is None:
                return
            if self.kind.get() == "坐标":
                x, y = picker.result
                if self.normalized.get():
                    x, y = round(x / (screen.width - 1), 6), round(y / (screen.height - 1), 6)
                self.x.set(str(x))
                self.y.set(str(y))
            else:
                path = self.app.base_dir / "assets" / f"capture_{uuid4().hex[:10]}.png"
                path.parent.mkdir(parents=True, exist_ok=True)
                screen.crop(picker.result).save(path)
                self.path.set(path.relative_to(self.app.base_dir).as_posix())
        except Exception as error:
            messagebox.showerror("截图选取失败", str(error), parent=self)

    def save(self):
        try:
            selector = replace(self.seed, name=self.name.get().strip(), kind="coordinate" if self.kind.get() == "坐标" else "image",
                                x=float(self.x.get()), y=float(self.y.get()), normalized=self.normalized.get(), image=self.path.get(),
                                threshold=float(self.threshold.get()), scales=[float(v.strip()) for v in self.scales.get().split(",")],
                                roi=[int(v.strip()) for v in self.roi.get().split(",")] if self.roi.get().strip() else None,
                                offset_x=int(self.offset_x.get()), offset_y=int(self.offset_y.get()))
            selector.validate()
            if any(s.name == selector.name and s.name != self.original for s in self.app.project.selectors):
                raise ValueError("控件名称已存在")
            if any(not (self.app.base_dir / asset).is_file() for asset in selector.asset_paths()):
                raise ValueError("模板文件不存在")
            self.result = selector
            self.destroy()
        except Exception as error:
            messagebox.showerror("控件校验失败", str(error), parent=self)


class Studio(tk.Tk):
    def __init__(self, path=None):
        super().__init__()
        self.title("EchoTest")
        self.geometry("1360x880")
        self.minsize(1100, 750)
        self.configure(bg="#eff3f8")
        self.project = Project()
        self.case_path = None
        self.base_dir = ROOT / "projects" / "untitled"
        self.windows = []
        self.selected_step = None
        self.dirty = False
        self.running = False
        self.stop_event = threading.Event()
        self.events = queue.Queue()
        self.last_report = None
        self.parameter_vars = {}
        self.setup_style()
        self.build()
        if path:
            self.open_path(path)
        self.refresh_windows()
        self.after(80, self.poll)
        self.protocol("WM_DELETE_WINDOW", self.close)
        self.bind("<Control-s>", lambda _: self.save())
        self.bind("<F12>", lambda _: self.stop())

    def setup_style(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(".", font=("Microsoft YaHei UI", 10), background="#eff3f8", foreground="#172c49")
        style.configure("TButton", padding=(12, 7))
        style.configure("Accent.TButton", background="#176bd6", foreground="white")
        style.map("Accent.TButton", background=[("active", "#0b57b8"), ("disabled", "#a5b6cd")])
        style.configure("Danger.TButton", background="#bd3655", foreground="white")
        style.configure("Muted.TLabel", foreground="#687b93")
        style.configure("Title.TLabel", font=("Microsoft YaHei UI", 22, "bold"))
        style.configure("Treeview", background="white", fieldbackground="white", rowheight=35, borderwidth=0)
        style.configure("Treeview.Heading", font=("Microsoft YaHei UI", 10, "bold"), padding=8)
        style.map("Treeview", background=[("selected", "#dceaff")], foreground=[("selected", "#134b96")])
        style.configure("TNotebook.Tab", padding=(22, 10))
        style.configure("TLabelframe.Label", font=("Microsoft YaHei UI", 10, "bold"))

    def build(self):
        header = ttk.Frame(self, padding=(22, 16))
        header.pack(fill="x")
        ttk.Label(header, text="EchoTest", style="Title.TLabel").pack(side="left")
        self.badge = tk.StringVar(value="管理员权限" if is_admin() else "普通权限 · 管理员客户端需使用管理员启动")
        ttk.Label(header, textvariable=self.badge, style="Muted.TLabel").pack(side="right")
        toolbar = ttk.Frame(self, padding=(22, 0, 22, 10))
        toolbar.pack(fill="x")
        for title, command in [("新建", self.new), ("打开用例", self.open), ("保存", self.save), ("另存为", lambda: self.save(as_new=True))]:
            ttk.Button(toolbar, text=title, command=command).pack(side="left", padx=(0, 7))
        ttk.Label(toolbar, text="用例名称").pack(side="left", padx=(16, 7))
        self.case_name = tk.StringVar(value=self.project.name)
        ttk.Entry(toolbar, textvariable=self.case_name, width=25).pack(side="left")
        self.case_name.trace_add("write", lambda *_: self.changed())
        connection = ttk.LabelFrame(self, text="目标应用连接", padding=(12, 8))
        connection.pack(fill="x", padx=22, pady=(0, 12))
        self.window_choice = tk.StringVar()
        self.window_combo = ttk.Combobox(connection, textvariable=self.window_choice, state="readonly", width=74)
        self.window_combo.pack(side="left", fill="x", expand=True)
        ttk.Button(connection, text="刷新窗口", command=self.refresh_windows).pack(side="left", padx=8)
        ttk.Label(connection, text="循环").pack(side="left", padx=(8, 3))
        self.iterations = tk.StringVar(value="1")
        ttk.Spinbox(connection, from_=1, to=1000, textvariable=self.iterations, width=5).pack(side="left")
        self.run_button = ttk.Button(connection, text="▶ 运行用例", command=self.run, style="Accent.TButton")
        self.run_button.pack(side="left", padx=(12, 6))
        self.stop_button = ttk.Button(connection, text="■ 停止 · F12", command=self.stop, state="disabled", style="Danger.TButton")
        self.stop_button.pack(side="left")
        self.tabs = ttk.Notebook(self)
        self.tabs.pack(fill="both", expand=True, padx=22)
        self.steps_tab = ttk.Frame(self.tabs, padding=12)
        self.targets_tab = ttk.Frame(self.tabs, padding=12)
        self.results_tab = ttk.Frame(self.tabs, padding=12)
        for frame, title in [(self.steps_tab, "用例编排"), (self.targets_tab, "控件库"), (self.results_tab, "执行结果")]:
            self.tabs.add(frame, text=title)
        self.build_steps()
        self.build_targets()
        self.build_results()
        self.status = tk.StringVar(value="就绪 · 先选择目标窗口，再校准控件；用图片断言验证目标应用状态变化")
        ttk.Label(self, textvariable=self.status, padding=(22, 12), style="Muted.TLabel").pack(side="bottom", fill="x", before=self.tabs)

    def build_steps(self):
        pane = ttk.Panedwindow(self.steps_tab, orient="horizontal")
        pane.pack(fill="both", expand=True)
        left = ttk.Frame(pane)
        right_outer = ttk.Frame(pane)
        form_canvas = tk.Canvas(right_outer, background="#eff3f8", highlightthickness=0)
        form_scroll = ttk.Scrollbar(right_outer, orient="vertical", command=form_canvas.yview)
        form_canvas.configure(yscrollcommand=form_scroll.set)
        ttk.Button(right_outer, text="应用步骤修改", command=self.apply_step, style="Accent.TButton").pack(side="bottom", fill="x", padx=10, pady=(8, 0))
        form_scroll.pack(side="right", fill="y")
        form_canvas.pack(side="left", fill="both", expand=True)
        right = ttk.LabelFrame(form_canvas, text="步骤配置 · 表单编辑", padding=16)
        form_id = form_canvas.create_window(0, 0, window=right, anchor="nw")
        right.bind("<Configure>", lambda _: form_canvas.configure(scrollregion=form_canvas.bbox("all")))
        form_canvas.bind("<Configure>", lambda event: form_canvas.itemconfigure(form_id, width=event.width))
        def scroll_form(event):
            widget = self.winfo_containing(event.x_root, event.y_root)
            while widget is not None:
                if widget is right_outer:
                    form_canvas.yview_scroll(-int(event.delta / 120), "units")
                    break
                widget = getattr(widget, "master", None)
        self.bind_all("<MouseWheel>", scroll_form, add="+")
        pane.add(left, weight=3)
        pane.add(right_outer, weight=2)
        actions = ttk.Frame(left)
        actions.pack(fill="x", pady=(0, 10))
        for title, command in [("＋ 新步骤", self.add_step), ("复制", self.duplicate_step), ("删除", self.delete_step), ("↑ 上移", lambda: self.move_step(-1)), ("↓ 下移", lambda: self.move_step(1))]:
            ttk.Button(actions, text=title, command=command).pack(side="left", padx=(0, 5))
        self.step_tree = ttk.Treeview(left, columns=("enabled", "name", "action", "target", "result"), show="headings", selectmode="browse")
        for key, label, width in [("enabled", "启用", 50), ("name", "步骤名称", 170), ("action", "事件", 100), ("target", "目标控件", 120), ("result", "状态", 85)]:
            self.step_tree.heading(key, text=label)
            self.step_tree.column(key, width=width, minwidth=40, stretch=key in {"name", "target"})
        scrollbar = ttk.Scrollbar(left, orient="vertical", command=self.step_tree.yview)
        self.step_tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.step_tree.pack(fill="both", expand=True)
        self.step_tree.bind("<<TreeviewSelect>>", self.load_step)
        ttk.Label(left, text="定位 → 执行事件 → 等待 / 断言 → 生成报告", style="Muted.TLabel", padding=(0, 12)).pack(anchor="w")
        right.columnconfigure(1, weight=1)
        self.step_name = tk.StringVar()
        self.step_action = tk.StringVar(value="单击")
        self.step_target = tk.StringVar()
        self.step_end = tk.StringVar()
        self.step_enabled = tk.BooleanVar(value=True)
        self.step_timeout = tk.StringVar(value="5")
        self.step_delay = tk.StringVar(value="0.5")
        self.step_repeat = tk.StringVar(value="1")
        entry_row(right, 0, "步骤名称", self.step_name)
        ttk.Label(right, text="事件类型").grid(row=1, column=0, sticky="w")
        self.action_combo = ttk.Combobox(right, textvariable=self.step_action, values=list(ACTIONS.values()), state="readonly")
        self.action_combo.grid(row=1, column=1, sticky="ew", pady=6)
        self.action_combo.bind("<<ComboboxSelected>>", lambda _: self.build_parameters())
        ttk.Label(right, text="目标控件").grid(row=2, column=0, sticky="w")
        self.target_combo = ttk.Combobox(right, textvariable=self.step_target, state="readonly")
        self.target_combo.grid(row=2, column=1, sticky="ew", pady=6)
        ttk.Label(right, text="拖动终点").grid(row=3, column=0, sticky="w")
        self.end_combo = ttk.Combobox(right, textvariable=self.step_end, state="readonly")
        self.end_combo.grid(row=3, column=1, sticky="ew", pady=6)
        entry_row(right, 4, "定位超时（秒）", self.step_timeout)
        entry_row(right, 5, "步骤后等待（秒）", self.step_delay)
        entry_row(right, 6, "步骤重复次数", self.step_repeat)
        ttk.Checkbutton(right, text="启用此步骤", variable=self.step_enabled).grid(row=7, column=1, sticky="w", pady=8)
        self.params_frame = ttk.LabelFrame(right, text="事件参数", padding=12)
        self.params_frame.grid(row=8, column=0, columnspan=2, sticky="ew", pady=10)
        ttk.Label(right, text="修改表单后请点击应用。图片断言可确认点击后的状态。\nF12 随时停止；失去目标应用焦点会停止输入。", style="Muted.TLabel", wraplength=370).grid(row=10, column=0, columnspan=2, sticky="w", pady=8)
        self.build_parameters()

    def build_parameters(self, values=None):
        for child in self.params_frame.winfo_children():
            child.destroy()
        self.parameter_vars = {}
        action = LABEL_TO_ACTION[self.step_action.get()]
        values = values or {}
        self.target_combo.configure(state="readonly" if action in TARGET_ACTIONS else "disabled")
        self.end_combo.configure(state="readonly" if action == "drag" else "disabled")
        self.params_frame.columnconfigure(1, weight=1)
        fields = PARAMETERS[action]
        if not fields:
            ttk.Label(self.params_frame, text="此事件无需额外参数", style="Muted.TLabel").grid(sticky="w")
        for row, (key, label, default) in enumerate(fields):
            variable = tk.StringVar(value=str(values.get(key, default)))
            self.parameter_vars[key] = variable
            entry_row(self.params_frame, row, label, variable, width=22)

    def build_targets(self):
        tools = ttk.Frame(self.targets_tab)
        tools.pack(fill="x", pady=(0, 12))
        for text, command in [("＋ 新增控件", self.add_selector), ("编辑控件", self.edit_selector), ("删除控件", self.delete_selector), ("预览定位（不点击）", self.preview_selector)]:
            ttk.Button(tools, text=text, command=command).pack(side="left", padx=(0, 8))
        self.target_tree = ttk.Treeview(self.targets_tab, columns=("name", "kind", "value", "threshold"), show="headings", selectmode="browse")
        for key, text, width in [("name", "控件名称", 190), ("kind", "定位方式", 120), ("value", "坐标 / 模板文件", 580), ("threshold", "阈值", 80)]:
            self.target_tree.heading(key, text=text)
            self.target_tree.column(key, width=width)
        self.target_tree.pack(fill="both", expand=True)
        self.target_tree.bind("<Double-1>", lambda _: self.edit_selector())
        ttk.Label(self.targets_tab, text="坐标以客户区左上角为原点，不含标题栏。截图控件点击匹配区域中心，可配置像素偏移。", style="Muted.TLabel", padding=(0, 12)).pack(anchor="w")

    def build_results(self):
        tools = ttk.Frame(self.results_tab)
        tools.pack(fill="x", pady=(0, 10))
        self.result_summary = tk.StringVar(value="尚未运行")
        ttk.Label(tools, textvariable=self.result_summary, font=("Microsoft YaHei UI", 13, "bold")).pack(side="left")
        ttk.Button(tools, text="打开报告", command=self.open_report).pack(side="right")
        self.log = tk.Text(self.results_tab, wrap="word", bg="#14243a", fg="#dbe7f7", insertbackground="white", font=("Consolas", 11), padx=16, pady=14, state="disabled")
        self.log.pack(fill="both", expand=True)

    def changed(self):
        self.dirty = True
        self.title("EchoTest · " + self.case_name.get() + " *")

    def guard(self):
        if self.running:
            self.status.set("执行期间无法编辑用例；请先停止")
            return False
        return True

    def refresh_windows(self):
        if not self.guard():
            return
        previous = self.window_choice.get()
        self.windows = list_game_windows()
        values = [f"PID {w.pid} · {w.title}" for w in self.windows]
        self.window_combo.configure(values=values)
        self.window_choice.set(previous if previous in values else values[0] if values else "")
        if not values:
            self.status.set("未找到可选窗口，请先打开目标应用后刷新")

    def game_window(self):
        index = self.window_combo.current()
        if index < 0 or index >= len(self.windows):
            raise ValueError("请先选择目标窗口")
        return self.windows[index]

    def game_capture(self):
        backend = WindowsBackend(self.game_window())
        # Capturing is read-only; activation's permission check is useful for execution,
        # but templates may be prepared even when the game has higher privileges.
        try:
            backend.activate()
        except RuntimeError as error:
            if "目标应用为管理员权限" not in str(error):
                raise
        screen = backend.capture()
        self.lift()
        return screen

    def store_image(self, path):
        directory = self.base_dir / "assets"
        directory.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
        dest = directory / f"template_{digest}{path.suffix.lower()}"
        if path.resolve() != dest.resolve():
            shutil.copy2(path, dest)
        return dest.relative_to(self.base_dir).as_posix()

    def refresh_project(self):
        self.step_tree.delete(*self.step_tree.get_children())
        for index, step in enumerate(self.project.steps):
            self.step_tree.insert("", "end", iid=str(index), values=("✓" if step.enabled else "—", f"{index+1}. {step.name}", ACTIONS[step.action], step.target, "待执行"))
        self.target_tree.delete(*self.target_tree.get_children())
        for index, selector in enumerate(self.project.selectors):
            value = f"({selector.x:g}, {selector.y:g}) " + ("比例" if selector.normalized else "像素") if selector.kind == "coordinate" else selector.image
            self.target_tree.insert("", "end", iid=str(index), values=(selector.name, "坐标" if selector.kind == "coordinate" else "截图识别", value, f"{selector.threshold:.2f}" if selector.kind == "image" else "—"))
        names = [s.name for s in self.project.selectors]
        self.target_combo.configure(values=names)
        self.end_combo.configure(values=names)
        self.selected_step = None

    def select_step(self, index):
        self.step_tree.selection_set(str(index))
        self.step_tree.see(str(index))
        self.load_step()

    def load_step(self, _=None):
        selected = self.step_tree.selection()
        if not selected:
            return
        index = int(selected[0])
        if index >= len(self.project.steps):
            return
        self.selected_step = index
        step = self.project.steps[index]
        for variable, value in [(self.step_name, step.name), (self.step_action, ACTIONS[step.action]), (self.step_target, step.target),
                                (self.step_end, step.end_target), (self.step_timeout, step.timeout), (self.step_delay, step.delay), (self.step_repeat, step.repeat)]:
            variable.set(str(value))
        self.step_enabled.set(step.enabled)
        self.build_parameters(step.params)

    def apply_step(self):
        if not self.guard() or self.selected_step is None:
            return
        try:
            action = LABEL_TO_ACTION[self.step_action.get()]
            params = {}
            for key, _, default in PARAMETERS[action]:
                raw = self.parameter_vars[key].get()
                params[key] = float(raw) if isinstance(default, (int, float)) else raw
            step = Step(name=self.step_name.get().strip() or ACTIONS[action], action=action, target=self.step_target.get(), end_target=self.step_end.get(),
                        enabled=self.step_enabled.get(), timeout=float(self.step_timeout.get()), delay=float(self.step_delay.get()), repeat=int(self.step_repeat.get()), params=params)
            if step.enabled:
                step.validate({s.name: s for s in self.project.selectors})
            index = self.selected_step
            self.project.steps[index] = step
            self.refresh_project()
            self.select_step(index)
            self.changed()
            self.status.set("步骤已应用")
        except Exception as error:
            messagebox.showerror("步骤配置错误", str(error), parent=self)

    def add_step(self):
        if not self.guard():
            return
        target = self.project.selectors[0].name if self.project.selectors else ""
        self.project.steps.append(Step(name="新步骤", target=target, enabled=bool(target)))
        self.refresh_project()
        self.select_step(len(self.project.steps) - 1)
        self.changed()

    def duplicate_step(self):
        if not self.guard() or self.selected_step is None:
            return
        index = self.selected_step + 1
        self.project.steps.insert(index, copy.deepcopy(self.project.steps[self.selected_step]))
        self.project.steps[index].name += " 副本"
        self.refresh_project()
        self.select_step(index)
        self.changed()

    def delete_step(self):
        if not self.guard() or self.selected_step is None:
            return
        index = self.selected_step
        self.project.steps.pop(index)
        self.refresh_project()
        if self.project.steps:
            self.select_step(min(index, len(self.project.steps)-1))
        self.changed()

    def move_step(self, direction):
        if not self.guard() or self.selected_step is None:
            return
        index, dest = self.selected_step, self.selected_step + direction
        if 0 <= dest < len(self.project.steps):
            self.project.steps[index], self.project.steps[dest] = self.project.steps[dest], self.project.steps[index]
            self.refresh_project()
            self.select_step(dest)
            self.changed()

    def add_selector(self):
        self.selector_dialog()

    def edit_selector(self):
        selected = self.target_tree.selection()
        if selected:
            self.selector_dialog(int(selected[0]))

    def selector_dialog(self, index=None):
        if not self.guard():
            return
        old = self.project.selectors[index] if index is not None else None
        dialog = SelectorDialog(self, old)
        self.wait_window(dialog)
        if dialog.result:
            if old:
                self.project.selectors[index] = dialog.result
                for step in self.project.steps:
                    if step.target == old.name:
                        step.target = dialog.result.name
                    if step.end_target == old.name:
                        step.end_target = dialog.result.name
                for selector in self.project.selectors:
                    if selector.anchor == old.name:
                        selector.anchor = dialog.result.name
            else:
                self.project.selectors.append(dialog.result)
            self.refresh_project()
            self.changed()

    def delete_selector(self):
        if not self.guard():
            return
        selected = self.target_tree.selection()
        if not selected:
            return
        index = int(selected[0])
        name = self.project.selectors[index].name
        if any(s.target == name or s.end_target == name for s in self.project.steps) or any(s.anchor == name for s in self.project.selectors):
            messagebox.showinfo("控件正在使用", "请先修改或删除引用此控件的步骤", parent=self)
            return
        self.project.selectors.pop(index)
        self.refresh_project()
        self.changed()

    def preview_selector(self):
        if not self.guard():
            return
        selected = self.target_tree.selection()
        if not selected:
            return
        try:
            selector = self.project.selectors[int(selected[0])]
            screen = self.game_capture()
            draw = ImageDraw.Draw(screen)
            if selector.kind == "coordinate":
                x, y = coordinate(selector, screen.size)
                text = f"{selector.name}：({x}, {y})"
            else:
                vision = Vision(self.base_dir)
                found = vision.match(screen, selector, {s.name: s for s in self.project.selectors})
                if not found:
                    detail = vision.last_diagnostic
                    candidate = detail.get("candidate")
                    if candidate:
                        bx, by, width, height = candidate["box"]
                        draw.rectangle((bx, by, bx+width, by+height), outline="#ee6541", width=3)
                    preview = CapturePicker(self, screen, "coordinate")
                    preview.title("定位诊断 · 未命中")
                    preview.hint.set(detail["reason"] + (f" · 最佳匹配度 {candidate['score']:.3f} · 倍率 {candidate['scale']:g}" if candidate else ""))
                    self.wait_window(preview)
                    return
                x, y = found.x, found.y
                bx, by, width, height = found.box
                draw.rectangle((bx, by, bx+width, by+height), outline="#00e3a6", width=3)
                text = f"{selector.name}：匹配度 {found.score:.3f}，中心 ({x}, {y})"
            draw.line((x-15, y, x+15, y), fill="#ff3d70", width=3)
            draw.line((x, y-15, x, y+15), fill="#ff3d70", width=3)
            preview = CapturePicker(self, screen, "coordinate")
            preview.title("定位预览 · 不发送输入")
            preview.hint.set(text)
            self.wait_window(preview)
        except Exception as error:
            messagebox.showerror("定位预览失败", str(error), parent=self)

    def abandon(self):
        return not self.dirty or messagebox.askyesno("未保存修改", "放弃当前未保存的修改？", parent=self)

    def new(self):
        if not self.guard() or not self.abandon():
            return
        self.project = Project()
        self.case_path = None
        self.base_dir = ROOT / "projects" / ("untitled_" + uuid4().hex[:6])
        self.case_name.set(self.project.name)
        self.refresh_project()
        self.dirty = False
        self.title("EchoTest · 新用例")

    def open(self):
        if not self.guard() or not self.abandon():
            return
        path = filedialog.askopenfilename(filetypes=[("EchoTest 用例", "*.json"), ("所有文件", "*.*")], parent=self)
        if path:
            self.open_path(Path(path))

    def open_path(self, path):
        try:
            self.project = load_project(Path(path))
            self.case_path = Path(path).resolve()
            self.base_dir = self.case_path.parent
            self.case_name.set(self.project.name)
            self.refresh_project()
            self.dirty = False
            self.title("EchoTest · " + self.project.name)
            self.status.set("已打开 " + str(self.case_path))
        except Exception as error:
            messagebox.showerror("打开失败", str(error), parent=self)

    def save(self, as_new=False):
        if not self.guard():
            return
        path = self.case_path
        if path is None or as_new:
            chosen = filedialog.asksaveasfilename(defaultextension=".echo.json", filetypes=[("EchoTest 用例", "*.echo.json")], parent=self)
            if not chosen:
                return
            path = Path(chosen)
        try:
            self.project.name = self.case_name.get()
            self.project = save_project(self.project, path, self.base_dir)
            self.case_path = path.resolve()
            self.base_dir = self.case_path.parent
            self.refresh_project()
            self.dirty = False
            self.title("EchoTest · " + self.project.name)
            self.status.set("用例已保存，模板已随用例复制到 assets")
        except Exception as error:
            messagebox.showerror("保存失败", str(error), parent=self)

    def append_log(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def run(self):
        if not self.guard():
            return
        try:
            self.project.name = self.case_name.get()
            self.project.validate()
            if not any(s.enabled for s in self.project.steps):
                raise ValueError("请先添加并启用测试步骤")
            iterations = int(self.iterations.get())
            if not 1 <= iterations <= 1000:
                raise ValueError("用例循环次数必须为 1 ~ 1000")
            backend = WindowsBackend(self.game_window(), self.stop_event.is_set)
            runner = Runner(backend, self.project, self.base_dir, ROOT / "reports", self.events.put)
            self.stop_event.clear()
            self.running = True
            self.run_button.configure(state="disabled")
            self.stop_button.configure(state="normal")
            self.action_combo.configure(state="disabled")
            self.window_combo.configure(state="disabled")
            self.tabs.select(self.results_tab)
            self.append_log(f"开始：{self.project.name} · 循环 {iterations} 次 · 目标 PID {backend.window.pid}")
            self.result_summary.set("执行中 · 按 F12 可停止")
            self.status.set("执行中，请保持目标窗口在前台")
            def worker():
                try:
                    runner.run(iterations)
                except Exception as error:
                    self.events.put({"kind": "fatal", "message": str(error)})
            threading.Thread(target=worker, daemon=True).start()
        except Exception as error:
            messagebox.showerror("无法运行", str(error), parent=self)

    def stop(self):
        if self.running:
            self.stop_event.set()
            self.status.set("正在停止并释放已按下的鼠标 / 按键…")

    def finish_controls(self):
        self.running = False
        self.run_button.configure(state="normal")
        self.stop_button.configure(state="disabled")
        self.action_combo.configure(state="readonly")
        self.window_combo.configure(state="readonly")

    def poll(self):
        try:
            while True:
                event = self.events.get_nowait()
                kind = event["kind"]
                if kind == "step":
                    state = {"running": "执行中", "passed": "完成", "failed": "失败", "stopped": "已停止"}[event["status"]]
                    iid = str(event["index"])
                    if self.step_tree.exists(iid):
                        self.step_tree.set(iid, "result", state)
                    self.append_log(f"[{state}] 第 {event['iteration']} 轮 / 步骤 {event['index']+1} / 重复 {event['repeat']} · {event['name']} · {event['action']}" + (" · " + event["error"] if event.get("error") else ""))
                elif kind in {"log", "match"}:
                    self.append_log(event["message"])
                elif kind == "finished":
                    self.finish_controls()
                    self.last_report = Path(event["directory"])
                    status = {"passed": "通过", "failed": "失败", "stopped": "已停止"}[event["result"]["status"]]
                    self.result_summary.set("执行结束：" + status)
                    self.status.set("报告：" + str(self.last_report))
                    self.append_log("结束：" + status + " · 报告保存至 " + str(self.last_report))
                elif kind == "fatal":
                    self.finish_controls()
                    self.result_summary.set("执行异常")
                    self.append_log(event["message"])
        except queue.Empty:
            pass
        self.after(80, self.poll)

    def open_report(self):
        if self.last_report and (self.last_report / "report.html").exists():
            os.startfile(str(self.last_report / "report.html"))
        else:
            messagebox.showinfo("报告", "请先运行一次用例", parent=self)

    def close(self):
        if self.running:
            self.stop()
            self.status.set("请等待当前执行停止后再关闭窗口")
            return
        if self.abandon():
            self.destroy()
