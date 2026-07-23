gdal_merge.py -o /work/data/dem.tif /work/dem/*/*_DSM.tif
gdaldem hillshade -s 111120 -az 315 -alt 45 /work/data/dem.tif /work/data/hillshade.tif
gdalwarp -t_srs EPSG:3857 /work/data/hillshade.tif /work/data/hillshade_3857.tif
gdal_translate -of MBTILES /work/data/hillshade_3857.tif /work/data/hillshade.mbtiles -co TILE_FORMAT=PNG
gdaladdo -r average /work/data/hillshade.mbtiles 2 4 8 16 32

