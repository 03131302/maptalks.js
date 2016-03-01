Z.renderer.map.Canvas = Z.renderer.map.Renderer.extend({
    initialize:function(map) {
        this.map = map;
        //container is a <canvas> element
        this._isCanvasContainer = !!map._containerDOM.getContext;
        this._registerEvents();
    },

    isCanvasRender:function() {
        return true;
    },

    /**
     * ��ȡͼ����Ⱦ����
     * @param  {Layer} layer ͼ��
     * @return {Dom}       ����Dom����
     */
    getLayerRendererContainer:function(layer) {
        if (!this._canvas) {
            this._createCanvas();
        }
        return this._canvas;
    },

    /**
     * ����Canvas����Ⱦ����, layers�ܶ�����Ҫ��Ⱦ��ͼ��
     */
    render:function() {

        if (!this._canvas) {
            this._createCanvas();
        }

        //���»����ĳ���, ˳����ջ���
        if (!this._updateCanvasSize()) {
            this._clearCanvas();
        }

        var mwidth = this._canvas.width,
            mheight = this._canvas.height;
        this._drawBackground();

        var layers = this._getAllLayerToCanvas();
        for (var i = 0, len=layers.length; i < len; i++) {
            if (!layers[i].isVisible()) {
                continue;
            }
            var render = layers[i]._getRenderer();
            if (render) {
                var layerImage = render.getCanvasImage();
                if (layerImage && layerImage['image']) {
                    this._drawLayerCanvasImage(layerImage, mwidth, mheight);
                }
            }
        }
    },

    onZoomStart:function(startScale, endScale, transOrigin, duration, fn) {
        if (Z.Browser.ielt9) {
            fn.call(this);
            return;
        }
        var map = this.map;
        var me = this;

        this._clearCanvas();
        var baseLayer = map.getBaseLayer();
        var baseLayerImage;
        if (baseLayer) {
            baseLayerImage =  baseLayer._getRenderer().getCanvasImage();
            this._canvasBg = Z.DomUtil.copyCanvas(baseLayerImage['image']);
            this._canvasBgRes = map._getResolution();
            this._canvasBgCoord = map.containerPointToCoordinate(baseLayerImage['point']);
        }
        if (map.options['zoomAnimation'] && this._context) {
            this._context.save();

            var width = this._canvas.width,
                height = this._canvas.height;
            var layersToTransform;
            if (!map.options['layerZoomAnimation']) {
                //zoom animation with better performance, only animate baseLayer, ignore other layers.
                if (baseLayerImage) {
                    this._drawLayerCanvasImage(baseLayerImage, width, height);
                }
                layersToTransform = [baseLayer];
            } else {
                //default zoom animation, animate all the layers.
                this.render();
            }
            var player = Z.Animation.animate(
                {
                    'scale' : [startScale, endScale]
                },
                {
                    'easing' : 'out',
                    'speed' : duration
                },
                Z.Util.bind(function(frame) {
                    var matrixes = this.getZoomMatrix(frame.styles['scale'], transOrigin);
                    if (player.playState === 'finished') {
                        delete this._transMatrix;
                        this._clearCanvas();
                        //only draw basetile layer
                        matrixes[1].applyToContext(this._context);
                        if (baseLayerImage) {
                            this._drawLayerCanvasImage(baseLayerImage, width, height);
                        }
                        this._context.restore();
                        fn.call(me);
                    } else if (player.playState === 'running'){
                        this.transform(matrixes[0], matrixes[1], layersToTransform);
                    }
                }, this)
            );
            player.play();
        } else {
            fn.call(me);
        }



    },

    /**
     * ��ͼ����з���任
     * @param  {Matrix} matrix �任����
     * @param  {Matrix} retinaMatrix retina��ʱ,��������ͼ��canvas�ı任����
     * @param  {maptalks.Layer[]} layersToTransform ����任�ͻ��Ƶ�ͼ��
     */
    transform:function(matrix, retinaMatrix, layersToTransform) {
        var mwidth = this._canvas.width,
            mheight = this._canvas.height;
        var layers = layersToTransform || this._getAllLayerToCanvas();
        this._transMatrix = matrix;
        var scale = matrix.decompose()['scale'];
        this._transMatrix._scale = scale;
        if (!retinaMatrix) {
            retinaMatrix = matrix;
        }

        //automatically enable updatePointsWhileTransforming with mobile browsers.
        var updatePoints = Z.Browser.mobile || this.map.options['updatePointsWhileTransforming'];
        this._clearCanvas();
        if (updatePoints) {
            this._context.save();
            retinaMatrix.applyToContext(this._context);
        }

        for (var i = 0, len=layers.length; i < len; i++) {
            if (!layers[i].isVisible()) {
                continue;
            }
            var render = layers[i]._getRenderer();
            if (render) {
                if (!updatePoints) {
                    this._context.save();
                    if ((layers[i] instanceof Z.TileLayer) || render.shouldUpdatePointsWhileTransforming()) {
                        retinaMatrix.applyToContext(this._context);
                    } else {
                        //redraw all the geometries with transform matrix
                        //this may bring low performance if number of geometries is large.
                        render.draw();
                    }
                }

                var layerImage = render.getCanvasImage();
                if (layerImage && layerImage['image']) {
                    this._drawLayerCanvasImage(layerImage, mwidth, mheight);
                }
                if (!updatePoints) {
                    this._context.restore();
                }
            }
        }
        if (updatePoints) {
            this._context.restore();
        }
    },

    /**
     * ��ȡ��ͼ��ǰ�ķ������
     * @return {Matrix} �������
     */
    getTransform:function() {
        return this._transMatrix;
    },

    updateMapSize:function(mSize) {
        if (!mSize || this._isCanvasContainer) {return;}
        var width = mSize['width'],
            height = mSize['height'];
        var panels = this.map._panels;
        panels.mapWrapper.style.width = width + 'px';
        panels.mapWrapper.style.height = height + 'px';
        panels.mapMask.style.width = width + 'px';
        panels.mapMask.style.height = height + 'px';
        panels.controlWrapper.style.width = width + 'px';
        panels.controlWrapper.style.height = height + 'px';
    },

    getPanel: function() {
        if (this._isCanvasContainer) {
            return this.map._containerDOM;
        }
        return this.map._panels.mapWrapper;
    },

    toDataURL:function(mimeType) {
        return this._canvas.toDataURL(mimeType);
    },

    /**
     * initialize container DOM of panels
     */
    initContainer:function() {
        var panels = this.map._panels;
        function createContainer(name, className, cssText) {
            var c = Z.DomUtil.createEl('div', className);
            if (cssText) {
                c.style.cssText = cssText;
            }
            panels[name] = c;
            return c;
        }
        var containerDOM = this.map._containerDOM;

        if (this._isCanvasContainer) {
            //container is a <canvas> element.
            return;
        }

        containerDOM.innerHTML = '';

        var controlWrapper = createContainer('controlWrapper', 'MAP_CONTROL_WRAPPER');
        var mapWrapper = createContainer('mapWrapper','MAP_WRAPPER', 'position:absolute;overflow:hidden;');
        var mapPlatform = createContainer('mapPlatform', 'MAP_PLATFORM', 'position:absolute;top:0px;left:0px;');
        var mapViewPort = createContainer('mapViewPort', 'MAP_VIEWPORT', 'position:absolute;top:0px;left:0px;z-index:10;-moz-user-select:none;-webkit-user-select: none;');
        var tipContainer = createContainer('tipContainer', 'MAP_TIP_CONTAINER', 'position:absolute;top:0px;left:0px;border:none;');
        var popMenuContainer = createContainer('popMenuContainer', 'MAP_POPMENU_CONTAINER', 'position:absolute;top:0px;left:0px;border:none;');
        var uiContainer = createContainer('uiContainer', 'MAP_UI_CONTAINER', 'position:absolute;top:0px;left:0px;border:none;');
        var canvasContainer = createContainer('canvasContainer', 'MAP_CANVAS_CONTAINER', 'position:absolute;top:0px;left:0px;border:none;');
        var mapMask = createContainer('mapMask', 'MAP_MASK', 'position:absolute;top:0px;left:0px;');

        canvasContainer.style.zIndex=1;
        mapMask.style.zIndex = 200;
        mapPlatform.style.zIndex = 300;
        controlWrapper.style.zIndex = 400;

        containerDOM.appendChild(mapWrapper);

        uiContainer.appendChild(tipContainer);
        uiContainer.appendChild(popMenuContainer);
        mapPlatform.appendChild(uiContainer);
        mapWrapper.appendChild(mapMask);
        mapWrapper.appendChild(mapPlatform);
        mapWrapper.appendChild(controlWrapper);
        mapWrapper.appendChild(canvasContainer);

        //���ie����קʸ��ͼ��ʱ����ͼdiv��ѡ�б����ɫ��bug
        if (Z.Browser.ie) {
            controlWrapper['onselectstart'] = function(e) {
                return false;
            };
            controlWrapper['ondragstart'] = function(e) { return false; };
            controlWrapper.setAttribute('unselectable', 'on');
            mapWrapper.setAttribute('unselectable', 'on');
            mapPlatform.setAttribute('unselectable', 'on');
        }
        //��ʼ��mapPlatform��ƫ����, ����css3 translateʱ���ó�ʼֵ
        this.offsetPlatform(new Z.Point(0,0));
        var mapSize = this.map._getContainerDomSize();
        this.updateMapSize(mapSize);
    },

    _registerEvents:function() {
        var map = this.map;
        map.on('_baselayerchangestart _baselayerload',function(param) {
            if (param['type'] === '_baselayerload') {
                if (!map.options['zoomBackground']) {
                    delete this._canvasBg;
                }
            }
           this.render();
        },this);
        map.on('_moving', function() {
            this.render();
        },this);
        map.on('_zoomstart',function() {
            delete this._canvasBg;
            this._clearCanvas();
        },this);
        if (typeof window !== 'undefined' ) {
            Z.DomUtil.on(window, 'resize', this._onResize, this);
        }
        if (!Z.Browser.mobile && Z.Browser.canvas) {
             this._onMapMouseMove=function(param) {
                if (map._isBusy()) {
                    return;
                }
                var vp = param['viewPoint'];
                var layers = map._getLayers();
                var hit = false,
                    cursor;
                for (var i = layers.length - 1; i >= 0; i--) {
                    var layer = layers[i];
                    if (!(layer instanceof Z.TileLayer) && layer.isCanvasRender()) {
                        if (layer.options['cursor'] !== 'default' && layer._getRenderer().hitDetect(vp)) {
                            cursor = layer.options['cursor'];
                            hit = true;
                            break;
                        }
                    }
                }
                if (hit) {
                    map._trySetCursor(cursor);
                } else {
                    map._trySetCursor('default');
                }
            };
            map.on('_mousemove',this._onMapMouseMove,this);
        }

    },


    _drawLayerCanvasImage:function(layerImage, mwidth, mheight) {
        if (!layerImage || mwidth === 0 || mheight === 0){
            return;
        }
        var alpha = this._context.globalAlpha;
        var point = layerImage['point'];
        var size = layerImage['size'];
        var canvasImage = layerImage['image'];
        if (Z.Util.isNumber(layerImage['opacity'])) {
            this._context.globalAlpha *= layerImage['opacity'];
        }
        if (Z.node) {
            var context = canvasImage.getContext('2d');
            if (context.getSvg) {
                 //canvas2svg
                canvasImage = context;
            }
            //CanvasMock����һ��ʵ����drawImage(img, sx, sy, w, h, dx, dy, w, h)
            this._context.drawImage(canvasImage, point.x, point.y);
        } else {
            var sx, sy, w, h, dx, dy;
            if (point.x <= 0) {
                sx = -point.x;
                dx = 0;
                w = Math.min(size['width']-sx,mwidth);
            } else {
                sx = 0;
                dx = point.x;
                w = mwidth-point.x;
            }
            if (point.y <= 0) {
                sy = -point.y;
                dy = 0;
                h = Math.min(size['height']-sy,mheight);
            } else {
                sy = 0;
                dy = point.y;
                h = mheight-point.y;
            }
            if (dx < 0 || dy < 0 || w <=0 || h <= 0) {
                return;
            }
            this._context.drawImage(canvasImage, sx, sy, w, h, dx, dy, w, h);
        }
        this._context.globalAlpha = alpha;
    },

    _drawBackground:function() {
        var map = this.map,
            size = map.getSize();
        if (this._canvasBg) {
            var scale = this._canvasBgRes/map._getResolution();
            var p = map.coordinateToContainerPoint(this._canvasBgCoord);
            var bSize = size._multi(scale);
            Z.Canvas.image(this._context, p, this._canvasBg, bSize['width'], bSize['height']);
        }
    },

    _getAllLayerToCanvas:function() {
        var layers = this.map._getLayers(function(layer) {
            if (layer && layer.isCanvasRender()) {
                return true;
            }
            return false;
        });
        return layers;
    },

    _clearCanvas:function() {
        if (!this._canvas) {
            return;
        }
        Z.Canvas.clearRect(this._context, 0, 0, this._canvas.width, this._canvas.height);
    },

    _updateCanvasSize: function() {
        if (!this._canvas || this._isCanvasContainer) {
            return;
        }
        var map = this.map;
        var mapSize = map.getSize();
        var canvas = this._canvas;
        var r = Z.Browser.retina ? 2:1;
        if (mapSize['width']*r === canvas.width && mapSize['height']*r === canvas.height) {
            return false;
        }
        //retina��֧��

        canvas.height = r * mapSize['height'];
        canvas.width = r * mapSize['width'];
        if (canvas.style) {
            canvas.style.width = mapSize['width']+'px';
            canvas.style.height = mapSize['height']+'px';
        }
        if (this._context) {
            Z.Canvas.resetContextState(this._context);
        }
        return true;
    },

    _createCanvas:function() {
        if (this._isCanvasContainer) {
            this._canvas = this.map._containerDOM;
        } else {
            this._canvas = Z.DomUtil.createEl('canvas');
            this._canvas.style.cssText = 'position:absolute;top:0px;left:0px;';
            this._updateCanvasSize();
            this.map._panels.canvasContainer.appendChild(this._canvas);
        }
        this._context = this._canvas.getContext('2d');
        if (Z.Browser.retina) {
            this._context.scale(2, 2);
        }

    },

    /**
     * ���õ�ͼ��watcher, �������ӵ�ͼ�����Ĵ�С�仯
     * @ignore
     */
    _onResize:function() {
        this.map.checkSize();
    }
});

Z.Map.registerRenderer('canvas', Z.renderer.map.Canvas);
