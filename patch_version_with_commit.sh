#!/bin/bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
reflog_message=$(git reflog -1)
merge_reason=$(echo $reflog_message | cut -d" " -f 3 | sed "s/://")
merged_branch_name=$(echo $reflog_message | cut -d" " -f 4 | sed "s/://")
branch_folder=$(echo $merged_branch_name | awk -F: 'match($0, /^[0-9a-zA-Z\-\_]+/) { print substr( $0, RSTART, RLENGTH )}')

pre_version=$(node -p -e "require('./package.json').version")

if [[ $merge_reason == "pull" ]]; then
    exit 0
fi
if [[ $branch_folder == "release" ]]; then
    exit 0
elif [[ $merged_branch_name == "production" ]]; then
    exit 0
elif [[ $merged_branch_name == $pre_version ]]; then
    # when we make release, merge branch name equal last version, so we up minor version
    npm version minor --no-git-tag-version
    PACKAGE_VERSION=$(node -p -e "require('./package.json').version")
    git add .
    git commit -n -m 'Up minor version after release to '$PACKAGE_VERSION
elif [[ "$BRANCH" == "master" ]]; then
    # when we merge some feature or some regular branch to master we, so we patch version
    npm version patch --no-git-tag-version
    PACKAGE_VERSION=$(node -p -e "require('./package.json').version")
    git add .
    git commit -n -m 'Bump version to '$PACKAGE_VERSION
fi

