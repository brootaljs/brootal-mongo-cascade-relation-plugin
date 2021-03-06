import _ from 'lodash';

async function onCascadeCreate(items, cascade, app, options) {
  async function addChildToParent(cascade, items) {
    let parent = await app.services[cascade.model].findById(items[0][cascade.parentId]);
    items.forEach((item) => {
      if (parent[cascade.field].indexOf(item._id) < 0) {
        parent[cascade.field].push(item._id);
      }
    });
    await parent.save(options);
  } 

  if (cascade.parent) {
    for (let i = 0; i < cascade.parent.length; i++) {
      if (cascade.parent[i].onCreation) {
        if (_.isArray(items)) {
          // group items to optimize creation if they has same parent
          let groupedItems = _.groupBy(items, cascade.parent[i].parentId);
          await Promise.all(Object.keys(groupedItems).map((datasetName) => addChildToParent(cascade.parent[i], groupedItems[datasetName])));
        } else {
          await addChildToParent(cascade.parent[i], [items]);
        }
      }
    }
  }
}

async function __onDeleteForParent(items, cascade, app, options) {
  if (!cascade.children) return;

  const deletedIds = _.map(items, item => item._id);

  await Promise.all(_.map(cascade.children, async child => {
    const filter = {};
    
    if (child.localField) {
      filter[child.foreignKey] = { 
        $in: _.flatten(_.map(items, item => item[ child.localField ]))
      };
    } else {
      filter[child.foreignKey] = { "$in": deletedIds };
    }
    
    return app.services[child.model].deleteMany(filter, options);
  }));
}

async function __onDeleteForChild(items, cascade, app, options) {
  async function deleteChildFromParent(cascade, childrens) {
    let itemsIds = _.flatten(childrens).map(item => item._id.toString());
    let parentId = childrens[0][cascade.parentId];
    
    let parent;
    try {
      parent = await app.services[cascade.model].findById(parentId);
    } catch (e) {
      console.log("MongoCascadeRelation.plugin (line : 54) | _onDeleteForChild | e : ", e);
    }
    
    if (parent) {
      if (_.isArray(parent[cascade.field])) {
        parent[cascade.field] = _.difference(parent[cascade.field], itemsIds);
      } else {
        parent[cascade.field] = itemsIds.indexOf(parent[cascade.field]) < 0 ? parent[cascade.field] : null;
      }
      
      try {
        await parent.save(options);
      } catch (e) {
        console.log("MongoCascadeRelation.plugin (line : 66) | _onDeleteForChild | e : ", e);
      }
    }
  }
  
  if (cascade.parent) {
    for (let i = 0; i < cascade.parent.length; i++) {
      if (cascade.parent[i].onDelete) {
        // group items to optimize creation if they has same parent
        let groupedItems = _.groupBy(items, cascade.parent[i].parentId);
        await Promise.all(Object.keys(groupedItems).map((datasetName) => deleteChildFromParent(cascade.parent[i], groupedItems[datasetName])));
      }
    }
  }
}

async function onCascadeDelete(items, cascade, app, options) {
  return Promise.all([
    __onDeleteForParent(items, cascade, app, options),
    __onDeleteForChild(items, cascade, app, options)
  ])
}

export default (cascade) => {
  return {
    staticMethods: {
      async findByIdAndDelete(id, options = {}) {
          if (this.beforeDelete) await this.beforeDelete(id);
          const result = await this.model.findByIdAndDelete(id, options);

          if (!options.withoutCascade && result) {
            try {
              await onCascadeDelete([result], cascade, this.app, options);
            } catch (e) {
              console.log("MongoCascadeRelation.plugin (line : 94) | findByIdAndDelete | e : ", e);
            }
          }

          if (this.afterDelete) {
            try {
              await this.afterDelete({ _id: id }, result ? [ result ] : result);
            } catch (e) {
              console.log("MongoCascadeRelation.plugin (line : 101) | findByIdAndDelete | e : ", e);
            }
          }

          return result;
      },

      async findOneAndDelete(filter = {}, options = {}) {
        if (this.beforeDelete) await this.beforeDelete(filter, options);
        const result = await this.model.findOneAndDelete(filter, options);

        if (!options.withoutCascade && result) await onCascadeDelete([result], cascade, this.app, options);

        if (this.afterDelete) await this.afterDelete(filter, result ? [ result ] : result);

        return result;
      },
      async deleteMany(filter = {}, options = {}) {
        if (this.beforeDelete) await this.beforeDelete(filter, options);
        let data = await this.model.find(filter, '_id'+(cascade.children ? ' '+cascade.children.map((c) => c.field).join(" "): ''));

        const res = await this.model.deleteMany(filter, options);

        if (!options.withoutCascade && res) await onCascadeDelete(data, cascade, this.app, options);
        if (this.afterDelete) await this.afterDelete(filter, data);

        return res;
      },
      async deleteOne(filter = {}, options = {}) {
        if (this.beforeDelete) await this.beforeDelete(filter, options = {});

        let data = await this.model.findOne(filter, '_id'+(cascade.children ? ' '+cascade.children.map((c) => c.field).join(" "): ''));

        const res = await this.model.deleteOne(filter, options);

        if (!options.withoutCascade && res) await onCascadeDelete([data], cascade, this.app, options);
        if (this.afterDelete) await this.afterDelete(filter, res ? [ res ] : res);

        return res;
      },
      async create(data, options = {}) {
        if (this.beforeCreate) data = await this.beforeCreate(data);

        let item;
        try {
            // create is universal method and its usage depends on 'data' type
            // Model.create({}) expected return type is Object
            // Model.create([{}]) expected return type is Array
            if (_.isArray(data)) {
                item = await this.model.create(data, options);
            } else {
                // To specify options, docs must be an array, not a spread
                item = await this.model.create([ data ], options);
                item = item[0];
            }
        } catch (e) {
            console.log("class (line : 147) | cascade create | e : ", e);
            throw e;
        }

        if (_.isArray(item)) {
            item = item.map((oneItem) => new this(oneItem.toObject()));
        } else {
            item = new this(item.toObject());
        }

        if (!options.withoutCascade) await onCascadeCreate((_.isArray(item) ? item : [item]), cascade, this.app, options);
        if (this.afterCreate) await this.afterCreate(data, item);

        return item;
      }
    }
  }
}