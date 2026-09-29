-- 0903 images are WebP (tools/perf/optimize_images.py converted assets/**.jpg|png and deleted the originals).
-- Rewrites stored asset paths: 'avatars/men-007.jpg' → 'avatars/men-007.webp', 'hero.png' → 'hero.webp' …
-- Only relative paths into the converted asset folders (optionally prefixed 'assets/' or '/assets/') and the
-- root aliases of window.SHIZHONG_ASSETS; URLs, data: and media: references are left alone.
-- The server also answers any old .jpg/.png asset URL with the .webp file (Infrastructure/Site.cs), so a value
-- this misses still loads. Columns found by scanning every text column of the dev database for image names.
DECLARE @cols TABLE (t SYSNAME, c SYSNAME);
INSERT @cols (t, c) VALUES
  (N'Users', N'Avatar'), (N'Posts', N'Image'), (N'LiveSessions', N'Cover'),
  (N'Services', N'Image'), (N'Orders', N'Image'), (N'OrderItems', N'Image'),
  (N'Banners', N'Image'), (N'Categories', N'Image'), (N'GiftBackgrounds', N'Image'),
  (N'Gifts', N'ArtFull'), (N'Gifts', N'ArtThumb'), (N'Gifts', N'ArtCharm');

DECLARE @dirs NVARCHAR(MAX) = N'';
SELECT @dirs = @dirs + N' OR {c} LIKE N''' + p + d + N'/%'''
FROM (VALUES (N'avatars'), (N'photos'), (N'animated-avatars'), (N'gift-art'), (N'gifts'), (N'flags'), (N'optimized'), (N'live-gifts'), (N'oriental')) AS dd(d)
CROSS JOIN (VALUES (N''), (N'assets/'), (N'/assets/')) AS pp(p);

DECLARE @aliases NVARCHAR(MAX) = N'N''cafe-brunch'', N''cake-table'', N''city-kl'', N''clean-home'', N''fresh-fruit'', N''hair-salon'', N''hero'', N''logo'', '
  + N'N''nasi-lemak'', N''portrait-man-river'', N''portrait-woman-city'', N''portrait-woman-outdoor'', N''portrait-woman-studio''';

DECLARE @t SYSNAME, @c SYSNAME, @sql NVARCHAR(MAX), @col NVARCHAR(300);
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT t, c FROM @cols;
OPEN cur;
FETCH NEXT FROM cur INTO @t, @c;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF COL_LENGTH(N'dbo.' + @t, @c) IS NOT NULL
  BEGIN
    SET @col = QUOTENAME(@c);
    -- stem = everything before the last '.'
    SET @sql = N'UPDATE dbo.' + QUOTENAME(@t) + N' SET ' + @col + N' = LEFT(' + @col + N', LEN(' + @col + N') - CHARINDEX(N''.'', REVERSE(' + @col + N'))) + N''.webp''
      WHERE (' + @col + N' LIKE N''%.jpg'' OR ' + @col + N' LIKE N''%.jpeg'' OR ' + @col + N' LIKE N''%.png'')
        AND ' + @col + N' NOT LIKE N''%:%''
        AND (LEFT(' + @col + N', LEN(' + @col + N') - CHARINDEX(N''.'', REVERSE(' + @col + N'))) IN (' + @aliases + N')'
        + REPLACE(@dirs, N'{c}', @col) + N')';
    EXEC sp_executesql @sql;
  END
  FETCH NEXT FROM cur INTO @t, @c;
END
CLOSE cur;
DEALLOCATE cur;
