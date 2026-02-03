# 1. 强制指定平台 linux/amd64 (解决 Mac M芯片 报错问题)
# 使用 PostGIS 官方镜像 (改用 17-3.5，因为 18 可能不稳定)
FROM --platform=linux/amd64 postgis/postgis:17-3.5

# 2. 替换国内源 (PG 17 基于 Debian Bookworm)
RUN echo "deb https://mirrors.ustc.edu.cn/debian/ bookworm main contrib non-free non-free-firmware" > /etc/apt/sources.list \
    && echo "deb https://mirrors.ustc.edu.cn/debian/ bookworm-updates main contrib non-free non-free-firmware" >> /etc/apt/sources.list \
    && echo "deb https://mirrors.ustc.edu.cn/debian-security/ bookworm-security main contrib non-free non-free-firmware" >> /etc/apt/sources.list

# 3. 安装编译依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg2 \
    git \
    make \
    gcc \
    build-essential \
    postgresql-server-dev-17 \
    && rm -rf /var/lib/apt/lists/*

# 4. 源码编译安装 pgvector (使用 v0.8.1)
RUN cd /tmp \
    && git clone --branch v0.8.1 https://github.com/pgvector/pgvector.git \
    && cd pgvector \
    && make \
    && make install \
    && cd .. \
    && rm -rf pgvector

# 5. 清理垃圾，减小镜像体积
RUN apt-get purge -y --auto-remove \
    git \
    make \
    gcc \
    build-essential \
    curl \
    gnupg2
