<?xml version="1.0" encoding="UTF-8"?>
<!-- synthetic CityGML fixture; never production data -->
<core:CityModel
  xmlns:core="http://www.opengis.net/citygml/2.0"
  xmlns:bldg="http://www.opengis.net/citygml/building/2.0"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:uro="https://www.geospatial.jp/iur/uro/2.0">
  <core:cityObjectMember>
    <bldg:Building gml:id="synthetic-inline">
      <bldg:measuredHeight uom="m">10</bldg:measuredHeight>
      <bldg:lod2Solid><gml:Solid><gml:exterior><gml:CompositeSurface>
        <gml:surfaceMember><gml:Polygon gml:id="inline-roof"><gml:exterior><gml:LinearRing>
          <gml:posList srsName="http://www.opengis.net/def/crs/EPSG/0/6697" srsDimension="3">35.6800 139.7500 20 35.6800 139.7501 20 35.6801 139.7501 20 35.6800 139.7500 20</gml:posList>
        </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
      </gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod2Solid>
    </bldg:Building>
  </core:cityObjectMember>
  <core:cityObjectMember>
    <bldg:Building gml:id="synthetic-xlink">
      <bldg:boundedBy><bldg:RoofSurface><bldg:lod2MultiSurface><gml:MultiSurface>
        <gml:surfaceMember><gml:Polygon gml:id="xlink-roof"><gml:exterior><gml:LinearRing>
          <gml:posList srsName="http://www.opengis.net/def/crs/EPSG/0/6697" srsDimension="3">35.6810 139.7510 30 35.6810 139.7511 30 35.6811 139.7511 30 35.6810 139.7510 30</gml:posList>
        </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
      </gml:MultiSurface></bldg:lod2MultiSurface></bldg:RoofSurface></bldg:boundedBy>
      <bldg:lod2Solid><gml:Solid><gml:exterior><gml:CompositeSurface>
        <gml:surfaceMember xlink:href="#xlink-roof" />
      </gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod2Solid>
    </bldg:Building>
  </core:cityObjectMember>
  <core:cityObjectMember>
    <bldg:Building gml:id="synthetic-parts">
      <bldg:consistsOfBuildingPart><bldg:BuildingPart gml:id="part-a">
        <bldg:lod2Solid><gml:Solid><gml:exterior><gml:CompositeSurface><gml:surfaceMember>
          <gml:Polygon gml:id="part-a-roof"><gml:exterior><gml:LinearRing>
            <gml:posList srsName="http://www.opengis.net/def/crs/EPSG/0/6697" srsDimension="3">35.6820 139.7520 10 35.6820 139.7522 10 35.6822 139.7522 10 35.6820 139.7520 10</gml:posList>
          </gml:LinearRing></gml:exterior><gml:interior><gml:LinearRing>
            <gml:posList srsDimension="3">35.68205 139.75205 10 35.68205 139.75210 10 35.68210 139.75210 10 35.68205 139.75205 10</gml:posList>
          </gml:LinearRing></gml:interior></gml:Polygon>
        </gml:surfaceMember></gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod2Solid>
      </bldg:BuildingPart></bldg:consistsOfBuildingPart>
      <bldg:consistsOfBuildingPart><bldg:BuildingPart gml:id="part-b">
        <bldg:lod2Solid><gml:Solid><gml:exterior><gml:CompositeSurface><gml:surfaceMember>
          <gml:Polygon gml:id="part-b-roof"><gml:exterior><gml:LinearRing>
            <gml:posList srsName="http://www.opengis.net/def/crs/EPSG/0/6697" srsDimension="3">35.6822 139.7522 42 35.6822 139.7524 42 35.6824 139.7524 42 35.6822 139.7522 42</gml:posList>
          </gml:LinearRing></gml:exterior></gml:Polygon>
        </gml:surfaceMember></gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod2Solid>
      </bldg:BuildingPart></bldg:consistsOfBuildingPart>
    </bldg:Building>
  </core:cityObjectMember>
  <core:cityObjectMember>
    <bldg:Building gml:id="synthetic-fallback">
      <bldg:measuredHeight uom="m">-9999</bldg:measuredHeight>
      <bldg:lod1Solid><gml:Solid><gml:exterior><gml:CompositeSurface><gml:surfaceMember>
        <gml:Polygon gml:id="fallback-lod1"><gml:exterior><gml:LinearRing>
          <gml:posList srsName="http://www.opengis.net/def/crs/EPSG/0/6697" srsDimension="3">35.6830 139.7530 12 35.6830 139.7531 12 35.6831 139.7531 22 35.6830 139.7530 12</gml:posList>
        </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
      </gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod1Solid>
      <bldg:lod2Solid><gml:Solid><gml:exterior><gml:CompositeSurface>
        <gml:surfaceMember xlink:href="#missing-surface" />
      </gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod2Solid>
    </bldg:Building>
  </core:cityObjectMember>
</core:CityModel>
