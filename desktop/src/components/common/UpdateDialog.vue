<script setup lang="ts">
/**
 * 更新下载弹框 —— 一个弹框走完整条更新链路：
 *   准备中 → 下载进度（百分比 / 大小 / 速度）→ 下载完成（重启并安装）→ 失败（重试 / 去 GitHub）
 *
 * 状态全部在 stores/update.ts 里（主进程 IPC 回调驱动），这里只负责展示 + 按钮。
 * 下载中允许关掉弹框（下载继续在后台跑），完成/失败时会自动再弹出来。
 */
import { computed } from 'vue'
import { useUpdateStore } from '@/stores/update'

const update = useUpdateStore()

const visible = computed({
  get: () => update.dialogVisible,
  set: (v: boolean) => { if (!v) update.hideDialog() },
})

const title = computed(() => {
  if (update.phase === 'downloaded') return '下载完成'
  if (update.phase === 'error') return '更新失败'
  return `正在下载 v${update.targetVersion}`
})

const percentText = computed(() => `${update.progress.percent.toFixed(1)}%`)
const sizeText = computed(() => {
  const { transferred, total } = update.progress
  if (!total) return formatBytes(transferred)
  return `${formatBytes(transferred)} / ${formatBytes(total)}`
})
const speedText = computed(() =>
  update.progress.speed > 0 ? `${formatBytes(update.progress.speed)}/s` : '',
)

/** 下载完成后的说明（路径可能很长，单独一行省略显示） */
const downloadedHint = computed(() =>
  update.restarting
    ? '应用已退出，安装界面马上弹出：按提示点「下一步 → 安装」，完成后会自动打开新版本。'
    : '点击「立即重启并安装」后应用会退出，随后弹出安装界面（默认装回原目录），按提示完成安装即可，装完自动打开新版本。',
)

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="440"
    align-center
    append-to-body
    :close-on-click-modal="false"
    class="update-dialog"
  >
    <!-- 准备中：还不知道总大小，走"不确定进度"滚动条 -->
    <div v-if="update.phase === 'preparing'" class="ud-block">
      <p class="ud-text">正在连接下载源…</p>
      <div class="progress-track ud-track">
        <div class="progress-fill ud-indeterminate" />
      </div>
      <p class="ud-hint">首次下载可能需要几秒，请稍候。</p>
    </div>

    <!-- 下载中：真实进度 -->
    <div v-else-if="update.phase === 'downloading'" class="ud-block">
      <div class="ud-row">
        <span class="ud-pct">{{ percentText }}</span>
        <span class="ud-size">
          {{ sizeText }}
          <template v-if="speedText"> · {{ speedText }}</template>
        </span>
      </div>
      <div class="progress-track ud-track">
        <div class="progress-fill ud-fill" :style="{ width: `${update.progress.percent}%` }" />
      </div>
      <p class="ud-hint">
        新版本 v{{ update.targetVersion }} 正在下载到本地，关闭本窗口不会中断下载，
        完成后会再次提醒你安装。
      </p>
    </div>

    <!-- 下载完成：重启并安装 -->
    <div v-else-if="update.phase === 'downloaded'" class="ud-block">
      <p class="ud-text">
        新版本 v{{ update.targetVersion }} 已下载完成。
      </p>
      <p class="ud-hint">{{ downloadedHint }}</p>
      <p v-if="update.localPath" class="ud-path" :title="update.localPath">
        安装包：{{ update.localPath }}
      </p>
    </div>

    <!-- 失败 -->
    <div v-else-if="update.phase === 'error'" class="ud-block">
      <p class="ud-text ud-error">{{ update.errorMessage || '下载失败' }}</p>
      <p class="ud-hint">
        可以点「重新下载」再试一次；如果一直失败，就去 GitHub 手动下载安装包。
      </p>
    </div>

    <template #footer>
      <!-- 下载中：只给"后台继续"，不提供取消（主进程不支持中断） -->
      <template v-if="update.busy">
        <el-button @click="update.hideDialog()">后台继续下载</el-button>
      </template>

      <!-- 下载完成 -->
      <template v-else-if="update.phase === 'downloaded'">
        <el-button
          :disabled="update.restarting"
          @click="update.openLocalFile()"
        >
          打开安装包
        </el-button>
        <el-button :disabled="update.restarting" @click="update.hideDialog()">
          稍后
        </el-button>
        <el-button
          type="primary"
          :loading="update.restarting"
          @click="update.restartAndInstall()"
        >
          {{ update.restarting ? '正在重启…' : '立即重启并安装' }}
        </el-button>
      </template>

      <!-- 失败 -->
      <template v-else>
        <el-button @click="update.hideDialog()">关闭</el-button>
        <el-button @click="update.retryDownload()">重新下载</el-button>
        <el-button
          v-if="update.errorUrl"
          type="primary"
          @click="update.openReleasePage()"
        >
          前往 GitHub 下载
        </el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.ud-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ud-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.ud-pct {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-title);
}
.ud-size {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-soft);
}
.ud-text {
  margin: 0;
  font-size: 14px;
  color: var(--text-body);
}
.ud-error {
  color: var(--danger-text);
  word-break: break-all;
}
.ud-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-soft);
}
.ud-path {
  margin: 0;
  font-size: 11px;
  color: var(--text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;                 /* 路径太长时优先显示文件名 */
  text-align: left;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--btn-ghost-bg);
}
/* 进度条：覆盖全局 1s 缓动，下载中要跟上真实进度 */
.ud-track {
  width: 100%;
}
.ud-fill {
  transition: width 0.2s linear;
}
/* 准备中：不确定进度条（来回滚动） */
.ud-indeterminate {
  width: 36%;
  animation: ud-slide 1.2s ease-in-out infinite;
}
@keyframes ud-slide {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(280%); }
}
</style>
