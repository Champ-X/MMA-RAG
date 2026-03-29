#!/usr/bin/env bash
# 将 Ubuntu apt 主源与安全源切换为国内镜像（加速 fonts-noto-cjk 等大包下载）。
# Ubuntu 22.04+ 常用 deb822：/etc/apt/sources.list.d/ubuntu.sources
# 用法：
#   sudo bash scripts/switch-ubuntu-apt-mirror.sh
#   sudo MIRROR=tuna bash scripts/switch-ubuntu-apt-mirror.sh
set -euo pipefail

MIRROR="${MIRROR:-aliyun}"

case "$MIRROR" in
  aliyun|Aliyun)
    BASE="http://mirrors.aliyun.com/ubuntu/"
    ;;
  tuna|tsinghua|TUNA)
    BASE="http://mirrors.tuna.tsinghua.edu.cn/ubuntu/"
    ;;
  ustc|USTC)
    BASE="http://mirrors.ustc.edu.cn/ubuntu/"
    ;;
  tencent|Tencent)
    BASE="http://mirrors.tencent.com/ubuntu/"
    ;;
  *)
    echo "未知 MIRROR=$MIRROR，可选: aliyun tuna ustc tencent" >&2
    exit 1
    ;;
esac

if [[ ${EUID:-0} -ne 0 ]]; then
  echo "请使用 root 或 sudo 运行，例如: sudo bash $0" >&2
  exit 1
fi

SRC_DEB822="/etc/apt/sources.list.d/ubuntu.sources"
SRC_LEGACY="/etc/apt/sources.list"

if [[ -f "$SRC_DEB822" ]]; then
  BAK="${SRC_DEB822}.bak.$(date +%Y%m%d%H%M%S)"
  cp -a "$SRC_DEB822" "$BAK"
  echo "已备份: $BAK"
  sed -i \
    -e "s|https\\?://archive\\.ubuntu\\.com/ubuntu/|${BASE}|g" \
    -e "s|https\\?://security\\.ubuntu\\.com/ubuntu/|${BASE}|g" \
    "$SRC_DEB822"
  echo "已写入 deb822 源: $SRC_DEB822 -> $BASE"
elif [[ -f "$SRC_LEGACY" ]]; then
  BAK="${SRC_LEGACY}.bak.$(date +%Y%m%d%H%M%S)"
  cp -a "$SRC_LEGACY" "$BAK"
  echo "已备份: $BAK"
  sed -i \
    -e "s|https\\?://archive\\.ubuntu\\.com/ubuntu/|${BASE}|g" \
    -e "s|https\\?://.*\\.ubuntu\\.com/ubuntu/|${BASE}|g" \
    -e "s|https\\?://security\\.ubuntu\\.com/ubuntu/|${BASE}|g" \
    "$SRC_LEGACY"
  echo "已写入 legacy 源: $SRC_LEGACY -> $BASE"
else
  echo "未找到 $SRC_DEB822 或 $SRC_LEGACY，请手动配置镜像。" >&2
  exit 1
fi

echo ""
echo "执行: apt-get update"
DEBIAN_FRONTEND=noninteractive apt-get update -qq
echo "完成。可继续: sudo apt-get install -y fonts-noto-cjk"
