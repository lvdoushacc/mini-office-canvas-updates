import os
import shutil
import subprocess
import time
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

CHROME_PATH = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_DIR = os.environ.get('XXPD_WORKSPACE_DIR', ROOT_DIR)

SCENARIOS = [
    # 1. 宽扁节点形态与内部状态 (深色)
    ('v2_img_01_init_dark.png', 'dark', 'image_init', '图片节点：宽扁初始/编辑状态 (深色)'),
    ('v2_img_02_running_dark.png', 'dark', 'image_running', '图片节点：Running 生成中 (深色)'),
    ('v2_img_03_success_dark.png', 'dark', 'image_success', '图片节点：Success 内部预览与送回画布按钮 (深色)'),
    ('v2_img_04_error_dark.png', 'dark', 'image_error', '图片节点：Error 失败提示与重试 (深色)'),
    ('v2_img_05_advanced_dark.png', 'dark', 'image_advanced', '图片节点：展开参数行 (深色)'),
    ('v2_img_06_lightbox_dark.png', 'dark', 'image_lightbox', '图片节点：大图预览 Lightbox 浮层 (深色)'),
    ('v2_vid_07_init_standard_dark.png', 'dark', 'video_standard', '视频节点：宽扁标准模式 (深色)'),
    ('v2_vid_08_first_last_dark.png', 'dark', 'video_first_last', '视频节点：首尾帧模式嵌入头部 (深色)'),
    ('v2_vid_09_omni_dark.png', 'dark', 'video_omni', '视频节点：全能参考模式 (深色)'),
    ('v2_vid_10_running_dark.png', 'dark', 'video_running', '视频节点：Running 运行态 (深色)'),
    ('v2_vid_11_success_dark.png', 'dark', 'video_success', '视频节点：Success 结果区与送回画布 (深色)'),
    ('v2_vid_12_error_dark.png', 'dark', 'video_error', '视频节点：Error 失败提示 (深色)'),
    ('v2_vid_13_lightbox_dark.png', 'dark', 'video_lightbox', '视频节点：专业视频播放器大预览 Overlay (深色)'),

    # 2. 生成节点 vs 生成结果解耦：独立 Canvas Media Object 与工具栏 (深色)
    ('v3_img_send_to_canvas_dark.png', 'dark', 'image_send_to_canvas', '图片生成解耦：送回画布生成独立图片素材 (深色)'),
    ('v3_media_image_selected_dark.png', 'dark', 'media_image_selected', '独立图片素材选中：上方紧随 7 项悬浮工具栏 (深色)'),
    ('v3_video_send_to_canvas_dark.png', 'dark', 'video_send_to_canvas', '视频生成解耦：送回画布生成独立视频素材 (深色)'),
    ('v3_media_video_selected_dark.png', 'dark', 'media_video_selected', '独立视频素材选中：上方紧随 5 项悬浮工具栏 (深色)'),
    ('v3_media_to_vid_wire_dark.png', 'dark', 'media_to_video_connection', '数据流打通：独立素材连线输入视频生成节点首帧 (深色)'),
    ('v2_pipeline_overview_dark.png', 'dark', 'pipeline_overview', '工作流全貌：完整数据流管线 (深色)'),

    # 3. 浅色模式完整对照 (Light Theme)
    ('v2_img_advanced_light.png', 'light', 'image_advanced', '图片节点：高级设置展开 (浅色)'),
    ('v2_vid_first_last_light.png', 'light', 'video_first_last', '视频节点：首尾帧模式 (浅色)'),
    ('v2_vid_success_light.png', 'light', 'video_success', '视频节点：Success 结果区 (浅色)'),
    ('v3_img_send_to_canvas_light.png', 'light', 'image_send_to_canvas', '图片生成解耦：送回画布生成独立图片素材 (浅色)'),
    ('v3_media_image_selected_light.png', 'light', 'media_image_selected', '独立图片素材选中：悬浮工具栏 (浅色)'),
    ('v3_media_video_selected_light.png', 'light', 'media_video_selected', '独立视频素材选中：悬浮工具栏 (浅色)'),
    ('v3_media_to_vid_wire_light.png', 'light', 'media_to_video_connection', '数据流打通：独立素材连线视频首帧 (浅色)'),
    ('v2_pipeline_overview_light.png', 'light', 'pipeline_overview', '工作流全貌：完整数据流管线 (浅色)')
]

def main():
    print(f'Starting screenshot capture for {len(SCENARIOS)} scenarios...')
    for filename, theme, scenario, desc in SCENARIOS:
        url = f'http://127.0.0.1:8900/index.html?theme={theme}&view=workspace&scenario={scenario}'
        local_path = os.path.join(WORKSPACE_DIR, filename)

        cmd = [
            CHROME_PATH,
            '--headless=new',
            '--disable-gpu',
            '--virtual-time-budget=2000',
            '--window-size=1440,900',
            f'--screenshot={local_path}',
            url
        ]

        res = subprocess.run(cmd, capture_output=True, text=True)
        if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
            print(f'✓ [{desc}] -> {filename} ({os.path.getsize(local_path)} bytes)')
        else:
            print(f'✗ Failed: {desc} (code {res.returncode})')

    print('All screenshots captured successfully!')

if __name__ == '__main__':
    main()
