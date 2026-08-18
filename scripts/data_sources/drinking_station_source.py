from pathlib import Path

from .source_utils import (
    BaseDataSource,
    DownloadRecord,
    OfficialResource,
    SourceMetadata,
    SourceStatus,
    download_file,
)


class DrinkingStationSource(BaseDataSource):
    def __init__(
        self,
        raw_directory: str | Path = "data/raw/drinking_station/",
    ) -> None:
        super().__init__(
            metadata=SourceMetadata(
                source_name="Tokyowater Drinking Station",
                provider="东京都水道局",
                source_page=(
                    "https://catalog.data.metro.tokyo.lg.jp/dataset/"
                    "t000019d0000000003"
                ),
                raw_directory=Path(raw_directory),
                processed_directory=Path("data/processed/drinking_station/"),
                status=SourceStatus.READY,
                required=False,
            ),
            expected_suffixes=(".csv",),
        )
        self.resources = (
            OfficialResource(
                filename="tokyowaterdrinkingstation_250917.csv",
                url=(
                    "https://www.opendata.metro.tokyo.lg.jp/suidou/R7/"
                    "tokyowaterdrinkingstation_250917.csv"
                ),
                license="CC BY",
                role="official_station_csv",
            ),
        )

    def fetch(self, force_download: bool = False) -> tuple[DownloadRecord, ...]:
        resource = self.resources[0]
        return (
            download_file(
                resource.url,
                self.metadata.raw_directory / resource.filename,
                force_download=force_download,
            ),
        )

    def download(self) -> tuple[DownloadRecord, ...]:
        return self.fetch()
