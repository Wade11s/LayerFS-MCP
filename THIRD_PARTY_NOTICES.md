# Third-party software

LayerFS-MCP uses the official Model Context Protocol TypeScript SDK and loads
LayerFS from an independently built upstream checkout or from the Docker image.
LayerFS is copyright its upstream authors and licensed under MIT:
https://github.com/Ephemeral-AI-Lab/layerfs/blob/5fb68ddc1acc3163e3ac3486133bde014c5fbed3/LICENSE

The Docker image retains the LayerFS SDK, native artifacts and its LICENSE. npm
dependencies retain their respective licenses. No LayerFS storage or merge
implementation is reimplemented in this project.

The native build applies patches/apple-container-podman.patch to LayerFS's own
Sandbox engine adapter. upstream.lock.json records its checksum. This patch
adds explicit Podman compatibility without changing the Store format or merge
algorithm; Docker remains the default engine. The original MIT license is kept.

The Apple runtime includes Debian-packaged Podman (Apache-2.0), crun
(GPL-2.0-or-later, with libcrun under LGPL-2.1-or-later), and their dependencies.
Package copyright and license texts
are retained under /usr/share/doc in the image. Apple Container is a separately
installed host dependency (Apache-2.0): https://github.com/apple/container
