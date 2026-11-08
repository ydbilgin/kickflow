@grid gallery columns=2
---
<table>
{{#gallery_rows}}
<tr>
{{#cells}}
<td width="{{gallery_cell_width}}%" valign="top">{{^filler}}<img src="{{file}}" alt="{{caption}}" width="100%"><br><sub>{{caption}}</sub>{{/filler}}</td>
{{/cells}}
</tr>
{{/gallery_rows}}
</table>
