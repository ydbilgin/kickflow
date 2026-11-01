<p align="center"><img src="{{icon}}" alt="{{name}} icon" width="96"></p>
<h1 align="center">{{name}}</h1>
<p align="center">
  <strong>{{tagline}}</strong><br>
  {{description}}
</p>
<p align="center">
{{#badges}}
  {{#link}}<a href="{{link}}">{{/link}}<img alt="{{alt}}" src="{{image}}">{{#link}}</a>{{/link}}
{{/badges}}
</p>
{{#hero}}
<p align="center"><img src="{{media}}" alt="{{alt}}" width="860"></p>
{{#caption}}
<p align="center"><sub>{{caption}}</sub></p>
{{/caption}}
<p align="center">
{{#nav}}
  <a href="{{link}}"><b>{{label}}</b></a>{{^last}} ·{{/last}}
{{/nav}}
</p>
{{/hero}}
