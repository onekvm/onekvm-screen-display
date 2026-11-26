SUMMARY = "OneKVM programmable screen SDK example"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://LICENSE;md5=94709c9b19d549c49355fc4fafb70d1a"

FILESEXTRAPATHS:prepend := "${THISDIR}/../../../examples:"
SRC_URI = "file://screen-sdk-example"
S = "${UNPACKDIR}/screen-sdk-example"

inherit onekvm-extension
DEPENDS += "pocketjs-native onekvm-screen-ui-native"
ONEKVM_EXTENSION_ID = "screen-sdk-example"
ONEKVM_EXTENSION_API_VERSION = "2"
ONEKVM_EXTENSION_MANIFEST_TEMPLATE = "${S}/manifest.json.in"
do_configure[noexec] = "1"

EXTRA_OEMAKE = "OUT_DIR=${B}/screen BUN=${STAGING_BINDIR_NATIVE}/bun SCREEN_UI=${STAGING_DATADIR_NATIVE}/onekvm-screen-ui POCKETJS=${STAGING_DATADIR_NATIVE}/pocketjs FONT_REG=${STAGING_DATADIR_NATIVE}/pocketjs/fonts/NotoSansCJKsc-Regular.otf FONT_BOLD=${STAGING_DATADIR_NATIVE}/pocketjs/fonts/NotoSansCJKsc-Bold.otf"

do_compile() {
    oe_runmake -C ${S} all
}

do_install() {
    oe_runmake -C ${S} install DESTDIR=${D} PREFIX=${ONEKVM_EXTENSION_ROOT} VERSION=${PV} ARCH=${TARGET_ARCH}
}
