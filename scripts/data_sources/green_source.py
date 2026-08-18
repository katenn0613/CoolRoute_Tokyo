from pathlib import Path

from .source_utils import (
    BaseDataSource,
    DownloadRecord,
    OfficialResource,
    SourceMetadata,
    SourceStatus,
    download_file,
)


GREEN_BASE_URL = "https://data.storage.data.metro.tokyo.lg.jp/toshiseibi"


class GreenSource(BaseDataSource):
    def __init__(self, raw_directory: str | Path = "data/raw/green/") -> None:
        super().__init__(
            metadata=SourceMetadata(
                source_name="緑のオープンデータ（GISデータ）",
                provider="東京都都市整備局 都市づくり政策部緑地景観課",
                source_page="https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000024",
                raw_directory=Path(raw_directory),
                processed_directory=Path("data/processed/green/"),
                status=SourceStatus.READY,
                required=True,
            ),
            expected_suffixes=(".gpkg", ".geojson", ".shp", ".zip"),
        )
        self.resources = (
            OfficialResource(
                filename="green_teigisho.pdf",
                url=f"{GREEN_BASE_URL}/green_teigisho.pdf",
                license="官方说明文档",
                role="database_definition",
            ),
            OfficialResource(
                filename="green_filelist.pdf",
                url=f"{GREEN_BASE_URL}/green_filelist.pdf",
                license="官方说明文档",
                role="file_list",
            ),
            OfficialResource(
                filename="03_jurinchi.zip",
                url=f"{GREEN_BASE_URL}/03_jurinchi.zip",
                license="CC BY",
                role="semantic_whitelist_candidate",
            ),
            OfficialResource(
                filename="10_koukyoushisetsu.zip",
                url=f"{GREEN_BASE_URL}/10_koukyoushisetsu.zip",
                license="CC BY",
                role="semantic_whitelist_candidate",
            ),
        )

    def fetch(self, force_download: bool = False) -> tuple[DownloadRecord, ...]:
        return tuple(
            download_file(
                resource.url,
                self.metadata.raw_directory / resource.filename,
                force_download=force_download,
            )
            for resource in self.resources
        )

    def download(self) -> tuple[DownloadRecord, ...]:
        return self.fetch()
