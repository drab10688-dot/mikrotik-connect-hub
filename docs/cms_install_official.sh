#!/bin/bash

# 定义变量action，version，env_path
# 执行的操作类型install或者upgrade
action=""
# 安装或升级的CMS版本
version=""
versionType="stable"

# 解析外部传入的参数
while [[ "$#" -gt 0 ]]; do
    case $1 in
    --version=*)
        version="${1#*=}"
        ;;
    --version)
        shift
        version="$1"
        ;;
    --dev)
        versionType="dev"
        ;;
    --beta)
        versionType="beta"
        ;;
    --stable)
        versionType="stable"
      ;;
    install | upgrade)
        action="$1"
        ;;
    *)
        echo "Illegal parameter: $1"
        exit 1
        ;;
    esac
    shift
done

# version不能为空
if [[ ! -n "$version" ]]; then
    echo "CMS version can not be empty"
    exit 1
    # version="latest"
fi

if [[ "$version" = "install" || "$version" = "upgrade" || "$version" = "--beta" ]]; then
    echo "Illegal parameter version: $version"
    exit 1
fi

if [[ -z "$action" ]]; then
    echo "install action can not be empty"
    exit 1
fi

# 任何命令执行失败就直接退出
set -e
# 1.从S3下载部署文件
curl -o cms.tar https://cms.s.cdatayun.com/cms_linux/"$versionType"/cms_v"$version"_linux.tar

# 2.执行init操作
if [[ "$action" = "install" ]]; then
    # 安装包解压到当前目录
    tar -xvf cms.tar
    # 更改文件所属用户，统一为root
    chown -R $USER:$USER ./
    # 赋予可执行权限
    chmod +x -R cms_init.sh cms.sh script/
    ./cms_init.sh "$action" '--version' "$version"
    # 删除安装包
    rm -rf cms.tar
elif [[ "$action" = "upgrade" ]]; then
    # 创建临时目录
    if [[ ! -d cms_temp ]]; then
        mkdir cms_temp
    fi
    # 升级包解压到临时目录
    tar -xvf cms.tar -C ./cms_temp
    # 更改文件所属用户，统一为root
    chown -R $USER:$USER ./cms_temp
    # 赋予可执行权限
    chmod +x ./cms_temp/cms_init.sh
    # 替换原docker-compose.yml文件
    cp -a ./cms_temp/docker-compose.yml ./docker-compose.yml
    # 执行升级操作
    ./cms_temp/cms_init.sh "$action" '--version' "$version"
    # 替换原cms_init.sh文件
    cp -a ./cms_temp/cms_init.sh ./cms_init.sh
    # 删除临时目录
    rm -rf ./cms_temp
    # 删除安装包
    rm -rf cms.tar
    curl -o cms_install.sh.bak https://cms.s.cdatayun.com/cms_linux/cms_install.sh
    mv -f cms_install.sh.bak "$0"
    chmod +x "$0"
else
    echo "Illegal parameter: $action"
fi
